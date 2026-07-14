#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install.sh  —  Audit Tool On-Premise Installer
# รองรับ: Ubuntu Server 24.04 LTS (amd64)
#
# Directory structure ที่ต้องมีก่อนรัน script นี้:
#
#   ~/audit-tool/              ← รัน script จากที่นี่
#   ├── install.sh             ← script นี้
#   ├── .env                   ← copy จาก on-premise/.env.example แล้วกรอกค่า
#   ├── database_dump.sql      ← export จาก Supabase (optional)
#   ├── attachments/           ← export จาก Supabase Storage (optional)
#   └── audit-tool/            ← git clone https://github.com/Thithanun/audit-tool.git
#       ├── package.json
#       ├── next.config.ts
#       └── on-premise/
#           ├── Dockerfile
#           ├── docker-compose.yml
#           ├── nginx.conf
#           └── init.sql
#
# วิธีเตรียม:
#   mkdir ~/audit-tool && cd ~/audit-tool
#   git clone https://github.com/Thithanun/audit-tool.git
#   cp audit-tool/on-premise/.env.example .env
#   nano .env          # กรอกค่าจริง
#   sudo bash install.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}ℹ${NC}  $*"; }
success() { echo -e "${GREEN}✓${NC}  $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; }
error()   { echo -e "${RED}✗${NC}  $*" >&2; }
step()    { echo -e "\n${BOLD}${BLUE}══ $* ══${NC}"; }
die()     { error "$*"; exit 1; }

# URL-encode a string for safe embedding in a postgres:// connection URI
# (passwords containing @ : / % # ? & etc. would otherwise corrupt the URI
# and cause silent authentication failures even with the "correct" password)
urlencode() {
  local raw="$1" i c encoded=""
  local length="${#raw}"
  for (( i = 0; i < length; i++ )); do
    c="${raw:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) encoded+="$c" ;;
      *) printf -v hex '%%%02X' "'$c"
         encoded+="$hex" ;;
    esac
  done
  printf '%s' "$encoded"
}

# Escape a string for safe use as a SQL single-quoted literal
sql_escape() { printf '%s' "$1" | sed "s/'/''/g"; }

# Escape a string for safe use as a sed replacement (with | as delimiter)
sed_escape() { printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'; }

# ── Must run as root ──────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "กรุณารัน script นี้ด้วย sudo: sudo bash install.sh"

# ── Resolve paths ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# DATA_DIR  = directory ที่มี .env, database_dump.sql, attachments/
# SOURCE_DIR = root ของ Next.js project (มี package.json)
# ONPREM_DIR = directory ที่มี Dockerfile, docker-compose.yml, nginx.conf, init.sql

# ── Detect layout ─────────────────────────────────────────────────────────────
# Layout A (default): install.sh อยู่ที่ ~/audit-tool/
#   SOURCE_DIR = ~/audit-tool/audit-tool/
#   ONPREM_DIR = ~/audit-tool/audit-tool/on-premise/
if [[ -f "${SCRIPT_DIR}/audit-tool/package.json" ]]; then
  DATA_DIR="${SCRIPT_DIR}"
  SOURCE_DIR="${SCRIPT_DIR}/audit-tool"
  ONPREM_DIR="${SOURCE_DIR}/on-premise"

# Layout B: install.sh อยู่ที่ ~/audit-tool/audit-tool/on-premise/
#   SOURCE_DIR = ~/audit-tool/audit-tool/
#   ONPREM_DIR = ~/audit-tool/audit-tool/on-premise/
elif [[ -f "${SCRIPT_DIR}/../package.json" ]]; then
  SOURCE_DIR="$(realpath "${SCRIPT_DIR}/..")"
  DATA_DIR="$(realpath "${SCRIPT_DIR}/../..")"
  ONPREM_DIR="${SCRIPT_DIR}"

else
  error "ไม่พบ source code — ตรวจสอบว่า clone repo มาแล้วหรือยัง"
  echo ""
  echo "  ขั้นตอน:"
  echo "  1. cd ~/audit-tool"
  echo "  2. git clone https://github.com/Thithanun/audit-tool.git"
  echo "  3. sudo bash install.sh"
  exit 1
fi

INSTALL_DIR="/opt/audit-tool"
ENV_FILE="${DATA_DIR}/.env"

# ── Verify critical paths ─────────────────────────────────────────────────────
[[ -f "${ENV_FILE}" ]]                 || die "ไม่พบ .env ที่ ${ENV_FILE}"
[[ -f "${SOURCE_DIR}/package.json" ]]  || die "ไม่พบ package.json ที่ ${SOURCE_DIR}"
[[ -f "${ONPREM_DIR}/Dockerfile" ]]    || die "ไม่พบ Dockerfile ที่ ${ONPREM_DIR}"
[[ -f "${ONPREM_DIR}/docker-compose.yml" ]] || die "ไม่พบ docker-compose.yml ที่ ${ONPREM_DIR}"
[[ -f "${ONPREM_DIR}/nginx.conf" ]]    || die "ไม่พบ nginx.conf ที่ ${ONPREM_DIR}"
[[ -f "${ONPREM_DIR}/init.sql" ]]      || die "ไม่พบ init.sql ที่ ${ONPREM_DIR}"

# ── Load .env ─────────────────────────────────────────────────────────────────
# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

# ── Validate required vars ────────────────────────────────────────────────────
for var in DOMAIN POSTGRES_PASSWORD JWT_SECRET \
           GOTRUE_DB_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD \
           NEXT_PUBLIC_SITE_URL; do
  [[ -n "${!var:-}" ]] || die "ตัวแปร ${var} ยังไม่ได้กรอกใน .env"
done

# LETSENCRYPT_EMAIL is only required for the default Let's Encrypt flow
SSL_MODE="${SSL_MODE:-letsencrypt}"
if [[ "${SSL_MODE}" == "letsencrypt" ]]; then
  [[ -n "${LETSENCRYPT_EMAIL:-}" ]] || die "ตัวแปร LETSENCRYPT_EMAIL ยังไม่ได้กรอกใน .env (จำเป็นเมื่อ SSL_MODE=letsencrypt)"
fi

# DOMAIN drives SSL cert path + nginx server_name; NEXT_PUBLIC_SITE_URL is what
# gets baked into the app's JS bundle + GoTrue's allow-list. They must point to
# the same host or the deployed app/SSL cert/auth redirects silently disagree.
NEXT_PUBLIC_SITE_HOST="$(printf '%s' "${NEXT_PUBLIC_SITE_URL}" | sed -E 's#^https?://##; s#/.*##')"
if [[ "${NEXT_PUBLIC_SITE_HOST}" != "${DOMAIN}" ]]; then
  die "DOMAIN (${DOMAIN}) กับโดเมนใน NEXT_PUBLIC_SITE_URL (${NEXT_PUBLIC_SITE_HOST}) ไม่ตรงกัน — ต้องเป็นโดเมนเดียวกันทั้งคู่ แก้ .env แล้วรันใหม่"
fi

# URL-encoded copies, used inside postgres:// connection URIs (GoTrue/PostgREST/Storage)
POSTGRES_PASSWORD_ENC="$(urlencode "${POSTGRES_PASSWORD}")"
GOTRUE_DB_PASSWORD_ENC="$(urlencode "${GOTRUE_DB_PASSWORD}")"
export POSTGRES_PASSWORD_ENC GOTRUE_DB_PASSWORD_ENC

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║      Audit Tool — On-Premise Installer               ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
info "Domain      : ${DOMAIN}"
info "Install dir : ${INSTALL_DIR}"
info "Source dir  : ${SOURCE_DIR}"
info "Config dir  : ${ONPREM_DIR}"
info "Data dir    : ${DATA_DIR}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: System packages
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 1: ติดตั้ง System Packages"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl wget gnupg2 lsb-release ca-certificates \
  apt-transport-https software-properties-common \
  nginx certbot python3-certbot-nginx \
  openssl git unzip

success "System packages ready"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: Node.js 20 LTS
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 2: ติดตั้ง Node.js 20 LTS"

if ! command -v node &>/dev/null \
   || [[ "$(node -e 'process.stdout.write(process.version.split(".")[0].slice(1))')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
success "Node.js $(node --version) ready"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: Docker + Docker Compose plugin
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 3: ติดตั้ง Docker"

if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) \
    signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
success "Docker $(docker --version | awk '{print $3}' | tr -d ',') ready"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4: Generate JWT tokens
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 4: สร้าง JWT Tokens"

_jwt() {
  local role="$1" secret="$2"
  local iat exp h p s
  iat=$(date +%s); exp=$((iat + 315360000))
  h=$(printf '{"alg":"HS256","typ":"JWT"}' | base64 | tr -d '=\n' | tr '+/' '-_')
  p=$(printf '{"role":"%s","iss":"supabase","iat":%d,"exp":%d}' \
        "$role" "$iat" "$exp" \
      | base64 | tr -d '=\n' | tr '+/' '-_')
  s=$(printf '%s.%s' "$h" "$p" \
      | openssl dgst -sha256 -hmac "$secret" -binary \
      | base64 | tr -d '=\n' | tr '+/' '-_')
  printf '%s.%s.%s' "$h" "$p" "$s"
}

if [[ -z "${ANON_KEY:-}" ]]; then
  ANON_KEY=$(_jwt "anon" "$JWT_SECRET")
  info "ANON_KEY generated"
fi
if [[ -z "${SERVICE_ROLE_KEY:-}" ]]; then
  SERVICE_ROLE_KEY=$(_jwt "service_role" "$JWT_SECRET")
  info "SERVICE_ROLE_KEY generated"
fi

# Write generated keys back to .env
{
  grep -v -E '^(ANON_KEY|SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_SERVICE_ROLE_KEY)=' \
    "${ENV_FILE}"
  printf 'ANON_KEY=%s\n' "$ANON_KEY"
  printf 'SERVICE_ROLE_KEY=%s\n' "$SERVICE_ROLE_KEY"
  printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n' "$ANON_KEY"
  printf 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=%s\n' "$ANON_KEY"
  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$SERVICE_ROLE_KEY"
} > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "${ENV_FILE}"

set -a; source "${ENV_FILE}"; set +a
success "JWT tokens ready"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5: Prepare /opt/audit-tool/
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 5: เตรียม Install Directory (${INSTALL_DIR})"

mkdir -p "${INSTALL_DIR}"

# Copy deployment config files from on-premise/ directory in the repo
cp "${ONPREM_DIR}/docker-compose.yml" "${INSTALL_DIR}/docker-compose.yml"
cp "${ONPREM_DIR}/init.sql"           "${INSTALL_DIR}/init.sql"
cp "${ENV_FILE}"                      "${INSTALL_DIR}/.env"

# Persist the URL-encoded passwords so `docker compose` picks them up even when
# run manually later (outside this script) — compose reads INSTALL_DIR/.env itself
if ! grep -qF "POSTGRES_PASSWORD_ENC=" "${INSTALL_DIR}/.env" 2>/dev/null; then
  {
    echo ""
    echo "# Auto-generated by install.sh — URL-encoded for use inside postgres:// URIs. Do not edit by hand."
    echo "POSTGRES_PASSWORD_ENC=${POSTGRES_PASSWORD_ENC}"
    echo "GOTRUE_DB_PASSWORD_ENC=${GOTRUE_DB_PASSWORD_ENC}"
  } >> "${INSTALL_DIR}/.env"
fi

# Fill in the real DB role passwords (init.sql ships with placeholders — it must
# match the passwords docker-compose.yml hands to each service, or GoTrue/PostgREST/
# Storage will fail to authenticate against Postgres on first boot).
# Values are SQL-escaped (quotes doubled) then sed-escaped for safe substitution.
sed -i \
  -e "s|__AUTHENTICATOR_PASSWORD__|$(sed_escape "$(sql_escape "${POSTGRES_PASSWORD}")")|g" \
  -e "s|__GOTRUE_DB_PASSWORD__|$(sed_escape "$(sql_escape "${GOTRUE_DB_PASSWORD}")")|g" \
  -e "s|__STORAGE_ADMIN_PASSWORD__|$(sed_escape "$(sql_escape "${POSTGRES_PASSWORD}")")|g" \
  "${INSTALL_DIR}/init.sql"

# Symlink source dir so docker-compose build context works
ln -sfn "${SOURCE_DIR}" "${INSTALL_DIR}/source"
info "Symlink: ${INSTALL_DIR}/source → ${SOURCE_DIR}"

# Copy database dump if present
if [[ -f "${DATA_DIR}/database_dump.sql" ]]; then
  cp "${DATA_DIR}/database_dump.sql" "${INSTALL_DIR}/database_dump.sql"
  info "Copied database_dump.sql ($(du -h "${DATA_DIR}/database_dump.sql" | cut -f1))"
fi

# Copy attachments if present
if [[ -d "${DATA_DIR}/attachments" ]]; then
  cp -r "${DATA_DIR}/attachments" "${INSTALL_DIR}/attachments"
  att_count=$(find "${DATA_DIR}/attachments" -type f | wc -l)
  info "Copied attachments/ (${att_count} file(s))"
fi

success "Install directory ready"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6: Build Docker image
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 6: Build Docker Image (Next.js)"

info "Build context : ${SOURCE_DIR}"
info "Dockerfile    : ${ONPREM_DIR}/Dockerfile"
info "Building audit-tool:latest — อาจใช้เวลาหลายนาที..."

docker build \
  --file    "${ONPREM_DIR}/Dockerfile" \
  --tag     audit-tool:latest \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SITE_URL}" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY}" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="${ANON_KEY}" \
  "${SOURCE_DIR}"

success "Docker image audit-tool:latest built"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7: Configure Nginx + SSL
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 7: ตั้งค่า Nginx + SSL"

if [[ "${SSL_MODE}" == "custom" ]]; then
  # ── Custom SSL: use a certificate already issued by the organization ────────
  info "SSL_MODE=custom — ใช้ certificate ที่องค์กรออกให้ (ข้าม Certbot/Let's Encrypt)"
  [[ -n "${SSL_CERT_FILE:-}" ]] || die "SSL_MODE=custom ต้องระบุ SSL_CERT_FILE ใน .env"
  [[ -n "${SSL_KEY_FILE:-}"  ]] || die "SSL_MODE=custom ต้องระบุ SSL_KEY_FILE ใน .env"
  [[ -f "${SSL_CERT_FILE}" ]] || die "ไม่พบไฟล์ certificate ที่ ${SSL_CERT_FILE}"
  [[ -f "${SSL_KEY_FILE}"  ]] || die "ไม่พบไฟล์ private key ที่ ${SSL_KEY_FILE}"

  mkdir -p "/etc/letsencrypt/live/${DOMAIN}"
  cp "${SSL_CERT_FILE}" "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  cp "${SSL_KEY_FILE}"  "/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
  chmod 600 "/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
  success "ติดตั้ง certificate ขององค์กรแล้ว (${DOMAIN})"
else
  # ── Let's Encrypt: requires DOMAIN to resolve to this server's public IP ────
  # Stop system nginx temporarily (Certbot needs port 80)
  systemctl stop nginx 2>/dev/null || true

  # Write temporary nginx for ACME challenge
  cat > /etc/nginx/sites-available/audit-tool <<NGINX_TEMP
server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 200 "Installing..."; add_header Content-Type text/plain; }
}
NGINX_TEMP
  ln -sf /etc/nginx/sites-available/audit-tool /etc/nginx/sites-enabled/audit-tool
  rm -f /etc/nginx/sites-enabled/default
  systemctl start nginx

  # Issue SSL certificate
  mkdir -p /var/www/certbot
  if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    info "Requesting SSL certificate for ${DOMAIN}..."
    certbot certonly --webroot \
      --webroot-path /var/www/certbot \
      --agree-tos --non-interactive \
      --email "${LETSENCRYPT_EMAIL}" \
      -d "${DOMAIN}"
    success "SSL certificate issued"
  else
    info "SSL certificate already exists"
  fi
fi

# Generate final nginx.conf (substitute DOMAIN_PLACEHOLDER)
sed "s/DOMAIN_PLACEHOLDER/${DOMAIN}/g" "${ONPREM_DIR}/nginx.conf" \
  > "${INSTALL_DIR}/nginx.conf"
info "nginx.conf written to ${INSTALL_DIR}/nginx.conf"

# Stop system nginx — Docker nginx takes over ports 80+443
systemctl stop  nginx
systemctl disable nginx 2>/dev/null || true
success "Nginx configured"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 8: Start PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 8: เริ่ม PostgreSQL"

cd "${INSTALL_DIR}"
docker compose up -d postgres

info "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  docker compose exec -T postgres pg_isready -U postgres &>/dev/null && break
  sleep 2
  [[ $i -lt 30 ]] || { docker compose logs postgres; die "PostgreSQL timeout"; }
done
success "PostgreSQL ready"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 9: Start GoTrue (creates auth schema)
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 9: เริ่ม GoTrue (Auth Service)"

docker compose up -d gotrue

info "Waiting for GoTrue to initialize auth schema..."
for i in $(seq 1 40); do
  docker compose exec -T gotrue wget -qO- http://localhost:9999/health &>/dev/null && break
  sleep 3
  [[ $i -lt 40 ]] || { docker compose logs gotrue; die "GoTrue timeout"; }
done

# Extra time for schema migration to finish
sleep 5
success "GoTrue ready"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 10: Create auth trigger
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 10: สร้าง Auth Trigger"

docker compose exec -T postgres psql -U postgres -d postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    RAISE NOTICE 'Trigger created';
  ELSE
    RAISE NOTICE 'Trigger already exists';
  END IF;

  -- profiles.id -> auth.users(id): deferred from init.sql since auth.users
  -- doesn't exist until GoTrue creates it (which only just happened above).
  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'profiles_id_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    RAISE NOTICE 'profiles FK to auth.users added';
  ELSE
    RAISE NOTICE 'profiles FK already exists';
  END IF;
END $$;
SQL
success "Auth trigger ready"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 11: Start MinIO and create its bucket
# ─────────────────────────────────────────────────────────────────────────────
# Must happen BEFORE the "storage" service starts (next step) — storage's
# healthcheck requires the "storage" bucket to already exist (GLOBAL_S3_BUCKET),
# otherwise it never becomes healthy and every service that depends_on it
# (app, nginx) fails to start too ("dependency failed to start: ... unhealthy").
step "STEP 11: เริ่ม MinIO และตั้งค่า Bucket"

docker compose up -d minio

for i in $(seq 1 20); do
  docker compose exec -T minio mc ready local &>/dev/null && break
  sleep 3
done

docker compose exec -T minio sh -c "
  mc alias set local http://localhost:9000 '${MINIO_ROOT_USER}' '${MINIO_ROOT_PASSWORD}' >/dev/null 2>&1
  mc mb --ignore-existing local/storage
"
# NOTE: Do NOT create local/storage/ncr-attachments here via mc mb — that would try
# to make a nested bucket (invalid in S3/MinIO). The 'storage' MinIO bucket is the
# global container (GLOBAL_S3_BUCKET) for ALL Supabase storage objects. The
# 'ncr-attachments' Supabase bucket is created later via the Storage API (STEP 12),
# which inserts into storage.buckets AND manages the S3 prefix automatically.
success "MinIO bucket ready"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 12: Start all remaining services
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 12: เริ่ม Services ที่เหลือทั้งหมด"

docker compose up -d

# Wait for the Next.js app to respond (checked inside the container to avoid
# nginx's HTTP→HTTPS redirect which makes `curl http://localhost` always get 301
# and never count as success when following is not enabled).
info "Waiting for app to be ready (up to 2 min)..."
for i in $(seq 1 24); do
  if docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null \
      | grep -q '"ok"'; then
    break
  fi
  sleep 5
  [[ $i -lt 24 ]] || warn "App health check timeout — ตรวจสอบ: docker compose logs app"
done
success "All services started"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 12b: ตั้งค่า Storage bucket + Storage RLS (no-auth mode)
# ─────────────────────────────────────────────────────────────────────────────
# The Storage API runs its own DB migrations when it first starts. We wait for
# the storage.objects table to exist, then:
#   1. Register 'ncr-attachments' bucket in storage.buckets (public = true so
#      browsers can GET files without a JWT via /storage/v1/object/public/…)
#   2. Add a policy allowing the 'anon' role to upload and delete files in that
#      bucket (in no-auth mode the browser sends the ANON_KEY JWT whose role
#      claim is 'anon' — without this policy the Storage API rejects uploads).

info "Waiting for Storage API migrations (storage.objects)..."
for i in $(seq 1 20); do
  obj_exists=$(docker compose exec -T postgres psql -U postgres -d postgres -tAc \
    "SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema='storage' AND table_name='objects';" 2>/dev/null || echo "0")
  obj_exists=$(echo "$obj_exists" | tr -d '[:space:]')
  if [[ "${obj_exists:-0}" -ge 1 ]]; then break; fi
  sleep 3
  [[ $i -lt 20 ]] || warn "storage.objects not found — file uploads may not work; re-run install.sh to retry"
done

docker compose exec -T postgres psql -U postgres -d postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) THEN
    RAISE NOTICE 'storage.objects not yet created — skipping bucket/policy setup';
    RETURN;
  END IF;

  -- Register the ncr-attachments Supabase bucket (public=true → browsers can GET
  -- files directly via /storage/v1/object/public/ncr-attachments/…)
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('ncr-attachments', 'ncr-attachments', TRUE)
  ON CONFLICT (id) DO UPDATE SET public = TRUE;

  -- Allow the anon role to upload, read, and delete files in this bucket.
  -- Required in no-auth mode: every visitor's browser sends the ANON_KEY JWT
  -- (role = 'anon') to the Storage API; without this policy the upload returns 403.
  DROP POLICY IF EXISTS "anon_full_access_ncr_attachments" ON storage.objects;
  CREATE POLICY "anon_full_access_ncr_attachments"
    ON storage.objects
    FOR ALL TO anon
    USING    (bucket_id = 'ncr-attachments')
    WITH CHECK (bucket_id = 'ncr-attachments');

  RAISE NOTICE 'ncr-attachments bucket and anon policy configured';
END $$;
SQL
success "Storage bucket configured"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 13: Restore data
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 13: Restore ข้อมูล"

if [[ -f "${INSTALL_DIR}/database_dump.sql" ]]; then
  info "Restoring database..."
  docker compose exec -T postgres psql -U postgres -d postgres \
    < "${INSTALL_DIR}/database_dump.sql"
  success "Database restored"
else
  info "ไม่พบ database_dump.sql — ข้ามขั้นตอนนี้ (restore ภายหลังได้ด้วย restore.sh)"
fi

if [[ -d "${INSTALL_DIR}/attachments" ]]; then
  info "Uploading attachments to MinIO..."
  docker cp "${INSTALL_DIR}/attachments/." \
    "$(docker compose ps -q minio)":/tmp/restore_att/
  docker compose exec -T minio sh -c "
    mc alias set local http://localhost:9000 '${MINIO_ROOT_USER}' '${MINIO_ROOT_PASSWORD}' >/dev/null 2>&1
    mc cp --recursive /tmp/restore_att/ local/storage/ncr-attachments/
    rm -rf /tmp/restore_att
  "
  success "Attachments uploaded"
else
  info "ไม่พบ attachments/ — ข้ามขั้นตอนนี้"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 14: Cron jobs
# ─────────────────────────────────────────────────────────────────────────────
step "STEP 14: ตั้ง Cron Jobs"

# SSL renewal (Let's Encrypt only — custom certs are managed by the org's own PKI/IT team)
if [[ "${SSL_MODE}" != "custom" ]] && ! grep -qF "certbot renew" /etc/cron.d/audit-tool-ssl 2>/dev/null; then
  cat > /etc/cron.d/audit-tool-ssl <<CRON
0 0,12 * * * root certbot renew --quiet --deploy-hook 'docker exec \$(docker ps -qf name=audit-tool-nginx) nginx -s reload'
CRON
  chmod 644 /etc/cron.d/audit-tool-ssl
  success "SSL renewal cron set (2x daily)"
fi

# Docker cleanup
if ! grep -qF "system prune" /etc/cron.d/audit-tool-cleanup 2>/dev/null; then
  cat > /etc/cron.d/audit-tool-cleanup <<CRON
0 3 * * 0 root docker system prune -f --filter 'until=168h' >> /var/log/audit-tool-cleanup.log 2>&1
CRON
  chmod 644 /etc/cron.d/audit-tool-cleanup
  success "Docker cleanup cron set (weekly)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# DONE
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║  ✅  ติดตั้งเสร็จสมบูรณ์!                            ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  🌐  URL         : ${BOLD}https://${DOMAIN}${NC}"
echo -e "  📁  Install dir : ${BOLD}${INSTALL_DIR}${NC}"
echo -e "  📦  Source dir  : ${BOLD}${SOURCE_DIR}${NC}"
echo ""
echo -e "  ${YELLOW}คำสั่งที่มีประโยชน์:${NC}"
echo -e "  ดู logs    : cd ${INSTALL_DIR} && docker compose logs -f"
echo -e "  หยุดระบบ   : cd ${INSTALL_DIR} && docker compose down"
echo -e "  ทดสอบระบบ  : bash ${DATA_DIR}/audit-tool/on-premise/test.sh"
echo -e "  Backup     : bash ${DATA_DIR}/audit-tool/on-premise/backup.sh"
echo ""
