#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# restore.sh  —  Restore database + attachments into running On-Premise stack
#
# วิธีใช้ (หลังจาก install.sh ทำงานเสร็จแล้ว):
#   sudo bash restore.sh
#
# Script นี้จะ:
#   1. Restore database_dump.sql → PostgreSQL (INSERT … ON CONFLICT DO NOTHING)
#   2. Upload ไฟล์แนบจาก attachments/ → MinIO bucket "ncr-attachments"
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}ℹ${NC}  $*"; }
success() { echo -e "${GREEN}✓${NC}  $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; }
error()   { echo -e "${RED}✗${NC}  $*" >&2; }

# ── Verify root ───────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "กรุณารัน script นี้ด้วย sudo: sudo bash restore.sh"
  exit 1
fi

# ── Load .env ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Prefer /opt/audit-tool/.env (post-install location), fall back to script dir
if [[ -f "/opt/audit-tool/.env" ]]; then
  ENV_FILE="/opt/audit-tool/.env"
  INSTALL_DIR="/opt/audit-tool"
elif [[ -f "${SCRIPT_DIR}/.env" ]]; then
  ENV_FILE="${SCRIPT_DIR}/.env"
  INSTALL_DIR="${SCRIPT_DIR}"
else
  error "ไม่พบไฟล์ .env — กรุณารัน install.sh ก่อน"
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# ── Source paths (where export files live) ────────────────────────────────────
# Script is in on-premise/, dump & attachments are one level up (project root)
APP_SOURCE="${SCRIPT_DIR}/.."
DB_DUMP="${APP_SOURCE}/database_dump.sql"
ATTACHMENTS_DIR="${APP_SOURCE}/attachments"

# If running from /opt/audit-tool after install, use copies there
[[ -f "${INSTALL_DIR}/database_dump.sql" ]] && DB_DUMP="${INSTALL_DIR}/database_dump.sql"
[[ -d "${INSTALL_DIR}/attachments"       ]] && ATTACHMENTS_DIR="${INSTALL_DIR}/attachments"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║      Audit Tool — Data Restore                       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Verify services are running
# ─────────────────────────────────────────────────────────────────────────────
cd "$INSTALL_DIR"

if ! docker compose ps postgres | grep -q "running\|healthy"; then
  error "PostgreSQL ไม่ได้รันอยู่ — กรุณาเริ่ม stack ก่อน: docker compose up -d"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# 1. Restore database
# ─────────────────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}── 1/2  Restore Database ──${NC}"

if [[ ! -f "$DB_DUMP" ]]; then
  warn "ไม่พบไฟล์ database_dump.sql ที่ ${DB_DUMP}"
  warn "ข้ามขั้นตอน restore database"
else
  info "Dump file  : ${DB_DUMP}"
  info "Dump size  : $(du -h "$DB_DUMP" | cut -f1)"

  # Count rows to restore
  INSERT_COUNT=$(grep -c "^INSERT INTO" "$DB_DUMP" 2>/dev/null || echo "?")
  info "INSERT rows: ${INSERT_COUNT}"

  echo ""
  read -rp "  ยืนยัน restore database? (y/N): " confirm
  if [[ "${confirm,,}" != "y" ]]; then
    info "ข้ามขั้นตอน restore database"
  else
    info "Restoring..."
    docker compose exec -T postgres psql -U postgres -d postgres < "$DB_DUMP"
    success "Database restored (${INSERT_COUNT} INSERT statements processed)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Restore attachments → MinIO
# ─────────────────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}── 2/2  Restore Attachments ──${NC}"

if [[ ! -d "$ATTACHMENTS_DIR" ]]; then
  warn "ไม่พบ folder attachments/ ที่ ${ATTACHMENTS_DIR}"
  warn "ข้ามขั้นตอน restore attachments"
else
  FILE_COUNT=$(find "$ATTACHMENTS_DIR" -type f | wc -l)
  TOTAL_SIZE=$(du -sh "$ATTACHMENTS_DIR" | cut -f1)
  info "Attachments dir : ${ATTACHMENTS_DIR}"
  info "Files to upload : ${FILE_COUNT} file(s), ${TOTAL_SIZE} total"

  echo ""
  read -rp "  ยืนยัน upload attachments → MinIO? (y/N): " confirm2
  if [[ "${confirm2,,}" != "y" ]]; then
    info "ข้ามขั้นตอน restore attachments"
  else
    # Wait for MinIO
    info "Waiting for MinIO..."
    for i in $(seq 1 20); do
      if docker compose exec -T minio curl -sf http://localhost:9000/minio/health/live &>/dev/null; then break; fi
      sleep 3
    done

    # Copy files into minio container then upload
    info "Copying files into MinIO container..."
    docker cp "${ATTACHMENTS_DIR}/." "$(docker compose ps -q minio)":/tmp/attachments/

    docker compose exec -T minio sh -c "
      set -e
      mc alias set local http://localhost:9000 '${MINIO_ROOT_USER}' '${MINIO_ROOT_PASSWORD}' >/dev/null 2>&1 || true
      mc mb --ignore-existing local/storage >/dev/null 2>&1 || true

      if [ -d /tmp/attachments ]; then
        # Files go to the 'storage' MinIO bucket at prefix 'ncr-attachments/'
        # (Supabase Storage API uses GLOBAL_S3_BUCKET=storage; all ncr-attachments
        # Supabase objects are stored at storage/ncr-attachments/{path} in MinIO)
        mc cp --recursive /tmp/attachments/ local/storage/ncr-attachments/
        echo 'Upload complete'
        mc ls --recursive local/storage/ncr-attachments/ | wc -l
        rm -rf /tmp/attachments
      fi
    "
    success "Attachments uploaded to MinIO (prefix: storage/ncr-attachments/)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}✅  Restore เสร็จสมบูรณ์${NC}"
echo ""
echo -e "  ตรวจสอบข้อมูลได้ที่ https://${DOMAIN}"
echo ""
