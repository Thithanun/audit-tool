#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# test.sh  —  Audit Tool On-Premise Health Check
# ตรวจสอบทุก service ว่าทำงานได้ปกติ
#
# วิธีใช้:
#   bash test.sh              # ตรวจสอบทั้งหมด
#   bash test.sh --quick      # ข้ามการทดสอบที่ใช้เวลานาน (SSL, app flow)
#   bash test.sh --json       # output เป็น JSON (สำหรับ monitoring tools)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

# ── Parse flags ───────────────────────────────────────────────────────────────
QUICK=false
JSON_OUT=false
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=true ;;
    --json)  JSON_OUT=true ;;
  esac
done

# ── Load .env ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE=""
INSTALL_DIR=""

if   [[ -f "/opt/audit-tool/.env" ]];   then ENV_FILE="/opt/audit-tool/.env";   INSTALL_DIR="/opt/audit-tool"
elif [[ -f "${SCRIPT_DIR}/.env" ]];     then ENV_FILE="${SCRIPT_DIR}/.env";     INSTALL_DIR="${SCRIPT_DIR}"
elif [[ -f "${SCRIPT_DIR}/../.env" ]];  then ENV_FILE="${SCRIPT_DIR}/../.env";  INSTALL_DIR="${SCRIPT_DIR}"
fi

if [[ -n "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

DOMAIN="${DOMAIN:-localhost}"
ANON_KEY="${ANON_KEY:-}"

# ── Result tracking ───────────────────────────────────────────────────────────
PASS=0; FAIL=0; WARN=0; SKIP=0
declare -a RESULTS=()  # "status|name|detail"

record() {
  local status="$1" name="$2" detail="${3:-}"
  RESULTS+=("${status}|${name}|${detail}")
  case "$status" in
    PASS) ((PASS++)) ;;
    FAIL) ((FAIL++)) ;;
    WARN) ((WARN++)) ;;
    SKIP) ((SKIP++)) ;;
  esac
}

check() {
  local name="$1"; shift
  local output
  if output=$("$@" 2>&1); then
    record PASS "$name" "$output"
    return 0
  else
    record FAIL "$name" "$output"
    return 1
  fi
}

# ── Print helpers ─────────────────────────────────────────────────────────────
print_results() {
  if $JSON_OUT; then
    echo "{"
    echo "  \"summary\": {\"pass\": $PASS, \"fail\": $FAIL, \"warn\": $WARN, \"skip\": $SKIP},"
    echo "  \"tests\": ["
    local first=true
    for r in "${RESULTS[@]}"; do
      IFS='|' read -r s n d <<< "$r"
      $first || echo ","
      first=false
      d_escaped="${d//\"/\\\"}"
      d_escaped="${d_escaped//$'\n'/ }"
      printf '    {"status": "%s", "name": "%s", "detail": "%s"}' "$s" "$n" "$d_escaped"
    done
    echo ""
    echo "  ]"
    echo "}"
    return
  fi

  echo ""
  echo -e "${BOLD}─────────────────────────────────────────────────────────────${NC}"
  printf "  %-42s %s\n" "TEST" "RESULT"
  echo -e "${BOLD}─────────────────────────────────────────────────────────────${NC}"

  for r in "${RESULTS[@]}"; do
    IFS='|' read -r s n d <<< "$r"
    case "$s" in
      PASS) icon="${GREEN}✓ PASS${NC}" ;;
      FAIL) icon="${RED}✗ FAIL${NC}" ;;
      WARN) icon="${YELLOW}⚠ WARN${NC}" ;;
      SKIP) icon="${DIM}– SKIP${NC}" ;;
    esac
    printf "  %-42s " "$n"
    echo -e "$icon"
    if [[ "$s" == "FAIL" && -n "$d" ]]; then
      echo -e "  ${DIM}   └─ ${d:0:120}${NC}"
    fi
  done

  echo -e "${BOLD}─────────────────────────────────────────────────────────────${NC}"

  local total=$((PASS + FAIL + WARN + SKIP))
  printf "  Total: %d   " "$total"
  echo -e "${GREEN}✓ $PASS${NC}  ${RED}✗ $FAIL${NC}  ${YELLOW}⚠ $WARN${NC}  ${DIM}– $SKIP${NC}"
  echo ""

  if [[ $FAIL -gt 0 ]]; then
    echo -e "  ${RED}${BOLD}ผลรวม: FAILED ($FAIL item(s) failed)${NC}"
  else
    echo -e "  ${GREEN}${BOLD}ผลรวม: ALL PASSED${NC}"
  fi
  echo ""
}

# ── Timeout helper (portable) ─────────────────────────────────────────────────
timed_curl() {
  curl --silent --max-time 10 "$@"
}

# ═════════════════════════════════════════════════════════════════════════════
$JSON_OUT || {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║      Audit Tool — Service Health Check               ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
  echo -e "  Domain : ${BOLD}${DOMAIN}${NC}"
  echo -e "  Mode   : $(${QUICK} && echo 'Quick' || echo 'Full')"
  echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Docker daemon
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 1. Docker ──────────────────────────────────────────────${NC}"

if command -v docker &>/dev/null; then
  ver=$(docker --version 2>/dev/null | head -1)
  record PASS "Docker installed" "$ver"
else
  record FAIL "Docker installed" "docker command not found"
fi

if docker info &>/dev/null 2>&1; then
  record PASS "Docker daemon running"
else
  record FAIL "Docker daemon running" "docker info failed — is Docker running?"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Docker Compose containers
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 2. Docker Containers ──────────────────────────────────${NC}"

COMPOSE_DIR=""
if [[ -f "/opt/audit-tool/docker-compose.yml" ]];  then COMPOSE_DIR="/opt/audit-tool"
elif [[ -f "${INSTALL_DIR}/docker-compose.yml" ]]; then COMPOSE_DIR="$INSTALL_DIR"
fi

check_container() {
  local svc="$1"
  if [[ -z "$COMPOSE_DIR" ]]; then
    record SKIP "Container: $svc" "docker-compose.yml not found"
    return
  fi
  local state
  state=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" ps --format json "$svc" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('State','unknown'))" 2>/dev/null \
    || docker compose -f "${COMPOSE_DIR}/docker-compose.yml" ps "$svc" 2>/dev/null | tail -1 | awk '{print $NF}')

  if echo "$state" | grep -qi "running\|healthy\|Up"; then
    record PASS "Container: $svc" "state=$state"
  else
    record FAIL "Container: $svc" "state=$state"
  fi
}

for svc in postgres gotrue rest storage minio app nginx; do
  check_container "$svc"
done

# ─────────────────────────────────────────────────────────────────────────────
# 3. PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 3. PostgreSQL ─────────────────────────────────────────${NC}"

if [[ -n "$COMPOSE_DIR" ]]; then
  # Basic connectivity
  if docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T postgres \
      pg_isready -U postgres &>/dev/null 2>&1; then
    record PASS "PostgreSQL: pg_isready"
  else
    record FAIL "PostgreSQL: pg_isready" "pg_isready returned non-zero"
  fi

  # Check public schema tables exist
  table_count=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T postgres \
    psql -U postgres -d postgres -tAc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "0")
  table_count=$(echo "$table_count" | tr -d '[:space:]')
  if [[ "${table_count:-0}" -ge 5 ]]; then
    record PASS "PostgreSQL: public schema tables" "${table_count} tables found"
  else
    record WARN "PostgreSQL: public schema tables" "Only ${table_count} tables — schema may not be initialized"
  fi

  # Check auth schema (created by GoTrue)
  auth_ok=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T postgres \
    psql -U postgres -d postgres -tAc \
    "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='auth';" 2>/dev/null || echo "0")
  auth_ok=$(echo "$auth_ok" | tr -d '[:space:]')
  if [[ "${auth_ok:-0}" -ge 1 ]]; then
    record PASS "PostgreSQL: auth schema exists"
  else
    record WARN "PostgreSQL: auth schema exists" "auth schema missing — GoTrue may not have started yet"
  fi

  # Check profiles table has data
  profile_count=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T postgres \
    psql -U postgres -d postgres -tAc \
    "SELECT COUNT(*) FROM public.profiles;" 2>/dev/null || echo "0")
  profile_count=$(echo "$profile_count" | tr -d '[:space:]')
  if [[ "${profile_count:-0}" -ge 1 ]]; then
    record PASS "PostgreSQL: profiles data" "${profile_count} user(s) found"
  else
    record WARN "PostgreSQL: profiles data" "No users yet — create the first user after deployment"
  fi
else
  record SKIP "PostgreSQL: pg_isready"            "docker-compose.yml not found"
  record SKIP "PostgreSQL: public schema tables"  "docker-compose.yml not found"
  record SKIP "PostgreSQL: auth schema exists"    "docker-compose.yml not found"
  record SKIP "PostgreSQL: profiles data"         "docker-compose.yml not found"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. GoTrue (Auth)
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 4. GoTrue (Auth) ──────────────────────────────────────${NC}"

if [[ -n "$COMPOSE_DIR" ]]; then
  gotrue_health=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T gotrue \
    wget -qO- http://localhost:9999/health 2>/dev/null || echo "")
  if echo "$gotrue_health" | grep -q "alive\|ok\|healthy\|{"; then
    record PASS "GoTrue: /health" "$(echo "$gotrue_health" | head -c 80)"
  else
    record FAIL "GoTrue: /health" "Unexpected response: ${gotrue_health:0:80}"
  fi
else
  record SKIP "GoTrue: /health" "docker-compose.yml not found"
fi

# Via Nginx (public endpoint)
if ! $QUICK; then
  gotrue_pub=$(timed_curl -o /dev/null -w "%{http_code}" \
    "https://${DOMAIN}/auth/v1/health" 2>/dev/null || echo "000")
  if [[ "$gotrue_pub" == "200" ]]; then
    record PASS "GoTrue: HTTPS /auth/v1/health" "HTTP $gotrue_pub"
  elif [[ "$gotrue_pub" == "000" ]]; then
    record WARN "GoTrue: HTTPS /auth/v1/health" "Could not reach (network/DNS issue?)"
  else
    record FAIL "GoTrue: HTTPS /auth/v1/health" "HTTP $gotrue_pub"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. PostgREST (REST API)
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 5. PostgREST ──────────────────────────────────────────${NC}"

if [[ -n "$COMPOSE_DIR" ]]; then
  rest_health=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T rest \
    wget -qO- http://localhost:3000/ 2>/dev/null | head -c 100 || echo "")
  if [[ -n "$rest_health" ]]; then
    record PASS "PostgREST: internal /" "$(echo "$rest_health" | head -c 80)"
  else
    record FAIL "PostgREST: internal /" "No response from localhost:3000"
  fi
fi

if ! $QUICK && [[ -n "$ANON_KEY" ]]; then
  rest_pub=$(timed_curl -o /dev/null -w "%{http_code}" \
    -H "apikey: ${ANON_KEY}" \
    "https://${DOMAIN}/rest/v1/profiles?select=id&limit=1" 2>/dev/null || echo "000")
  if [[ "$rest_pub" == "200" ]]; then
    record PASS "PostgREST: HTTPS /rest/v1/profiles" "HTTP $rest_pub"
  elif [[ "$rest_pub" == "000" ]]; then
    record WARN "PostgREST: HTTPS /rest/v1/profiles" "Could not reach"
  else
    record FAIL "PostgREST: HTTPS /rest/v1/profiles" "HTTP $rest_pub"
  fi
elif $QUICK; then
  record SKIP "PostgREST: HTTPS /rest/v1/profiles" "--quick mode"
else
  record SKIP "PostgREST: HTTPS /rest/v1/profiles" "ANON_KEY not set"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 6. MinIO (Object Storage)
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 6. MinIO ──────────────────────────────────────────────${NC}"

if [[ -n "$COMPOSE_DIR" ]]; then
  minio_ready=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T minio \
    curl -sf http://localhost:9000/minio/health/live 2>&1 || echo "failed")
  if [[ "$minio_ready" != "failed" ]]; then
    record PASS "MinIO: health check" "HTTP 200 from /minio/health/live"
  else
    record FAIL "MinIO: health check" "$(echo "$minio_ready" | head -c 120)"
  fi

  # Check bucket exists
  bucket_check=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T minio \
    sh -c "mc alias set local http://localhost:9000 '${MINIO_ROOT_USER:-minioadmin}' '${MINIO_ROOT_PASSWORD:-minioadmin}' >/dev/null 2>&1; \
           mc ls local/storage/ncr-attachments 2>&1 | head -5" 2>/dev/null || echo "failed")
  if echo "$bucket_check" | grep -qv "ERROR\|failed\|does not exist"; then
    record PASS "MinIO: bucket ncr-attachments" "accessible"
  else
    record FAIL "MinIO: bucket ncr-attachments" "$(echo "$bucket_check" | head -c 120)"
  fi
else
  record SKIP "MinIO: health check"            "docker-compose.yml not found"
  record SKIP "MinIO: bucket ncr-attachments" "docker-compose.yml not found"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 7. Storage API
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 7. Storage API ────────────────────────────────────────${NC}"

if [[ -n "$COMPOSE_DIR" ]]; then
  storage_health=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T storage \
    wget -qO- http://localhost:5000/status 2>/dev/null || echo "")
  if [[ -n "$storage_health" ]]; then
    record PASS "Storage API: internal /status" "$(echo "$storage_health" | head -c 80)"
  else
    record FAIL "Storage API: internal /status" "No response"
  fi
else
  record SKIP "Storage API: internal /status" "docker-compose.yml not found"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. Next.js App
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 8. Next.js App ────────────────────────────────────────${NC}"

if [[ -n "$COMPOSE_DIR" ]]; then
  # Internal health check
  app_health=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T app \
    wget -qO- http://localhost:3000/api/health 2>/dev/null || echo "")
  if echo "$app_health" | grep -q "ok"; then
    record PASS "Next.js: internal /api/health" "$app_health"
  else
    record FAIL "Next.js: internal /api/health" "${app_health:-no response}"
  fi
fi

if ! $QUICK; then
  # Public HTTPS
  app_pub=$(timed_curl -o /dev/null -w "%{http_code}" \
    "https://${DOMAIN}/" 2>/dev/null || echo "000")
  if [[ "$app_pub" == "200" || "$app_pub" == "307" || "$app_pub" == "302" ]]; then
    record PASS "Next.js: HTTPS /" "HTTP $app_pub"
  elif [[ "$app_pub" == "000" ]]; then
    record WARN "Next.js: HTTPS /" "Could not reach — check DNS / firewall"
  else
    record FAIL "Next.js: HTTPS /" "HTTP $app_pub"
  fi

  # /api/health over HTTPS
  health_pub=$(timed_curl -o /dev/null -w "%{http_code}" \
    "https://${DOMAIN}/api/health" 2>/dev/null || echo "000")
  if [[ "$health_pub" == "200" ]]; then
    record PASS "Next.js: HTTPS /api/health" "HTTP $health_pub"
  elif [[ "$health_pub" == "000" ]]; then
    record SKIP "Next.js: HTTPS /api/health" "unreachable (same as above)"
  else
    record FAIL "Next.js: HTTPS /api/health" "HTTP $health_pub"
  fi
else
  record SKIP "Next.js: HTTPS /"           "--quick mode"
  record SKIP "Next.js: HTTPS /api/health" "--quick mode"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 9. Nginx
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 9. Nginx ──────────────────────────────────────────────${NC}"

if [[ -n "$COMPOSE_DIR" ]]; then
  nginx_test=$(docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T nginx \
    nginx -t 2>&1 || echo "")
  if echo "$nginx_test" | grep -q "syntax is ok\|test is successful"; then
    record PASS "Nginx: config syntax" "syntax ok"
  else
    record FAIL "Nginx: config syntax" "$(echo "$nginx_test" | head -c 200)"
  fi
fi

# HTTP → HTTPS redirect
if ! $QUICK; then
  http_redirect=$(timed_curl -o /dev/null -w "%{http_code}" \
    "http://${DOMAIN}/" 2>/dev/null || echo "000")
  if [[ "$http_redirect" == "301" || "$http_redirect" == "302" ]]; then
    record PASS "Nginx: HTTP→HTTPS redirect" "HTTP $http_redirect"
  elif [[ "$http_redirect" == "000" ]]; then
    record WARN "Nginx: HTTP→HTTPS redirect" "Port 80 unreachable"
  else
    record WARN "Nginx: HTTP→HTTPS redirect" "HTTP $http_redirect (expected 301/302)"
  fi
else
  record SKIP "Nginx: HTTP→HTTPS redirect" "--quick mode"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 10. SSL Certificate
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 10. SSL Certificate ───────────────────────────────────${NC}"

CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [[ -f "$CERT_PATH" ]]; then
  record PASS "SSL: certificate file exists" "$CERT_PATH"

  # Expiry check
  expiry_str=$(openssl x509 -enddate -noout -in "$CERT_PATH" 2>/dev/null | sed 's/notAfter=//')
  if [[ -n "$expiry_str" ]]; then
    expiry_epoch=$(date -d "$expiry_str" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$expiry_str" +%s 2>/dev/null || echo "0")
    now_epoch=$(date +%s)
    days_left=$(( (expiry_epoch - now_epoch) / 86400 ))

    if [[ $days_left -gt 30 ]]; then
      record PASS "SSL: certificate expiry" "${days_left} days remaining (expires: ${expiry_str})"
    elif [[ $days_left -gt 0 ]]; then
      record WARN "SSL: certificate expiry" "⚠ Only ${days_left} days remaining — renewal soon"
    else
      record FAIL "SSL: certificate expiry" "Certificate has EXPIRED!"
    fi
  else
    record WARN "SSL: certificate expiry" "Could not parse expiry date"
  fi

  # Domain match
  cert_cn=$(openssl x509 -subject -noout -in "$CERT_PATH" 2>/dev/null \
    | grep -oP '(?<=CN\s=\s)[^\s,]+' || echo "")
  cert_san=$(openssl x509 -ext subjectAltName -noout -in "$CERT_PATH" 2>/dev/null || echo "")
  if echo "${cert_cn}${cert_san}" | grep -q "${DOMAIN}"; then
    record PASS "SSL: domain match" "cert covers ${DOMAIN}"
  else
    record WARN "SSL: domain match" "CN=${cert_cn} (expected ${DOMAIN})"
  fi
else
  if $QUICK; then
    record SKIP "SSL: certificate file exists" "--quick mode"
    record SKIP "SSL: certificate expiry"      "--quick mode"
    record SKIP "SSL: domain match"            "--quick mode"
  else
    record WARN "SSL: certificate file exists" "${CERT_PATH} not found — run install.sh first"
    record SKIP "SSL: certificate expiry"      "no cert file"
    record SKIP "SSL: domain match"            "no cert file"
  fi
fi

if ! $QUICK; then
  # TLS handshake via openssl s_client
  tls_check=$(echo Q | openssl s_client -connect "${DOMAIN}:443" \
    -servername "${DOMAIN}" 2>/dev/null | grep "Verify return code" || echo "")
  if echo "$tls_check" | grep -q "ok (0)"; then
    record PASS "SSL: TLS handshake" "$(echo "$tls_check" | head -c 80)"
  elif [[ -z "$tls_check" ]]; then
    record WARN "SSL: TLS handshake" "Could not connect to ${DOMAIN}:443"
  else
    record WARN "SSL: TLS handshake" "$(echo "$tls_check" | head -c 120)"
  fi
else
  record SKIP "SSL: TLS handshake" "--quick mode"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 11. Cron jobs
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 11. Cron Jobs ─────────────────────────────────────────${NC}"

for cronfile in /etc/cron.d/audit-tool-ssl /etc/cron.d/audit-tool-backup /etc/cron.d/audit-tool-cleanup; do
  name=$(basename "$cronfile")
  if [[ -f "$cronfile" ]]; then
    record PASS "Cron: ${name}" "$(head -1 "$cronfile" | head -c 80)"
  else
    record WARN "Cron: ${name}" "not found — run install.sh or backup.sh to create"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# 12. Disk space
# ─────────────────────────────────────────────────────────────────────────────
$JSON_OUT || echo -e "${BLUE}── 12. Disk Space ────────────────────────────────────────${NC}"

root_usage=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
if [[ "${root_usage:-0}" -lt 80 ]]; then
  record PASS "Disk: root partition" "$(df -h / | awk 'NR==2 {print $3"/"$2" used ("$5")"}' )"
elif [[ "${root_usage:-0}" -lt 90 ]]; then
  record WARN "Disk: root partition" "$(df -h / | awk 'NR==2 {print $5}') used — consider cleanup"
else
  record FAIL "Disk: root partition" "$(df -h / | awk 'NR==2 {print $5}') used — CRITICAL"
fi

if docker info &>/dev/null 2>&1; then
  docker_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo "/var/lib/docker")
  docker_usage=$(df -h "$docker_root" | awk 'NR==2 {print $5}' | tr -d '%')
  if [[ "${docker_usage:-0}" -lt 80 ]]; then
    record PASS "Disk: Docker root" "$(df -h "$docker_root" | awk 'NR==2 {print $3"/"$2" ("$5")"}')"
  elif [[ "${docker_usage:-0}" -lt 90 ]]; then
    record WARN "Disk: Docker root" "${docker_usage}% used"
  else
    record FAIL "Disk: Docker root" "${docker_usage}% used — CRITICAL"
  fi
fi

# ── Print summary ─────────────────────────────────────────────────────────────
print_results

# Exit code: 0 = all pass/warn, 1 = any fail
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
