#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# export-db.sh  —  Export Supabase database (schema + data) to a SQL dump
# ─────────────────────────────────────────────────────────────────────────────
#
# ต้องการ: pg_dump  (มาพร้อม PostgreSQL client tools)
#   macOS  : brew install postgresql
#   Ubuntu : sudo apt install postgresql-client
#   Windows: ติดตั้งผ่าน WSL/Git Bash + postgresql-client
#            หรือดาวน์โหลด pg_dump.exe แยกจาก https://www.enterprisedb.com/
#
# วิธีใช้:
#   bash scripts/export-db.sh
#
# ตัวเลือก ENV:
#   DB_PASSWORD   — database password (ถ้าไม่ตั้ง จะถามให้กรอก)
#
# หา DB password ได้จาก:
#   Supabase Dashboard → Project Settings → Database → Database password
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
EXPORTS_DIR="${SCRIPT_DIR}/exports"

# ── Load .env.local ──────────────────────────────────────────────────────────
if [ -f "${PROJECT_ROOT}/.env.local" ]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^\s*#' "${PROJECT_ROOT}/.env.local" | grep -v '^\s*$')
  set +a
  echo "✓ Loaded env from .env.local"
fi

# ── Validate env ─────────────────────────────────────────────────────────────
if [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  echo "❌  NEXT_PUBLIC_SUPABASE_URL is not set"
  exit 1
fi

# Extract project ref: https://rinfhcbxrqngavtiqops.supabase.co → rinfhcbxrqngavtiqops
PROJECT_REF=$(echo "${NEXT_PUBLIC_SUPABASE_URL}" \
  | sed 's|https://||' \
  | sed 's|\.supabase\.co.*||')

if [ -z "${PROJECT_REF}" ]; then
  echo "❌  Could not extract project ref from NEXT_PUBLIC_SUPABASE_URL"
  exit 1
fi

echo "📋 Project ref: ${PROJECT_REF}"

# ── Database password ────────────────────────────────────────────────────────
if [ -z "${DB_PASSWORD:-}" ]; then
  echo ""
  echo "🔑 Enter your Supabase database password"
  echo "   (Supabase Dashboard → Project Settings → Database → Database password)"
  read -rsp "Password: " DB_PASSWORD
  echo ""
fi

# ── Connection string ────────────────────────────────────────────────────────
# Uses Supabase's direct connection (port 5432, not the pooler)
DB_HOST="db.${PROJECT_REF}.supabase.co"
DB_URL="postgresql://postgres:${DB_PASSWORD}@${DB_HOST}:5432/postgres"

# ── Output file ──────────────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="${EXPORTS_DIR}/db_dump_${TIMESTAMP}.sql"
mkdir -p "${EXPORTS_DIR}"

echo ""
echo "🔄 Connecting to ${DB_HOST}..."
echo "   Output → ${OUTPUT_FILE}"
echo ""

# ── Run pg_dump ───────────────────────────────────────────────────────────────
# Flags:
#   --no-owner        : ไม่ include ownership (portable ข้าม Supabase projects)
#   --no-acl          : ไม่ include GRANT/REVOKE (RLS policies ยังอยู่)
#   --schema=public   : export เฉพาะ public schema (tables, functions, policies)
#   --format=plain    : plain SQL text (อ่านได้, import ด้วย psql)
PGPASSWORD="${DB_PASSWORD}" pg_dump \
  --host="${DB_HOST}" \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --no-owner \
  --no-acl \
  --schema=public \
  --format=plain \
  --verbose \
  > "${OUTPUT_FILE}" 2>&1

SIZE=$(du -sh "${OUTPUT_FILE}" | cut -f1)
ROWS=$(grep -c '^INSERT INTO\|^COPY ' "${OUTPUT_FILE}" 2>/dev/null || echo "n/a")

echo ""
echo "✅ Database exported successfully"
echo "   File : ${OUTPUT_FILE}"
echo "   Size : ${SIZE}"
echo "   Data statements : ${ROWS}"
echo ""
echo "📌 To restore on a new Supabase project:"
echo "   psql 'postgresql://postgres:<new-password>@db.<new-ref>.supabase.co:5432/postgres' < ${OUTPUT_FILE}"
