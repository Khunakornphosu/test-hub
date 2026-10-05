#!/usr/bin/env bash
# เปิด Test Studio ให้คนในทีมลองใช้ผ่าน Cloudflare quick tunnel (URL สุ่มใหม่ทุกครั้งที่ start)
#   scripts/share.sh start   เปิด Postgres, runner, หน้าเว็บ และ tunnel 2 เส้น แล้วพิมพ์ URL + รหัสผ่าน
#   scripts/share.sh stop    ปิดทุกอย่างที่ start เปิดไว้ (Postgres ยังเปิดอยู่)
#   scripts/share.sh status  ดู URL และสถานะปัจจุบัน
# ACCESS_PASSWORD=... scripts/share.sh start  กำหนดรหัสผ่านเอง (ไม่กำหนด = สุ่มให้)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/.share"
WEB_PORT=4700
RUNNER_PORT=4800
mkdir -p "$STATE"

log() { printf '\033[1m[share]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[share] %s\033[0m\n' "$*" >&2; exit 1; }
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
random_secret() { openssl rand -hex "${1:-24}"; }

start_bg() { # start_bg <name> <cwd> <command...>
  local name=$1 cwd=$2; shift 2
  # subshell exec เป็นคำสั่งจริง และไม่ถือ stdout ของสคริปต์ไว้ (ไม่งั้นคำสั่งที่เรียกสคริปต์จะรอไม่จบ)
  (cd "$cwd" && exec nohup "$@" >"$STATE/$name.log" 2>&1 </dev/null) &
  echo $! >"$STATE/$name.pid"
}

tunnel_url() { # รอ URL ของ quick tunnel จาก log
  local file=$1
  for _ in $(seq 1 60); do
    local url
    url=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$file" 2>/dev/null | head -1 || true)
    [ -n "$url" ] && { echo "$url"; return 0; }
    sleep 1
  done
  return 1
}

wait_http() { # wait_http <url> [curl args...]
  local url=$1; shift
  for _ in $(seq 1 90); do
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "$@" "$url" || true)
    [ "$code" = 200 ] && return 0
    sleep 1
  done
  return 1
}

stop_all() {
  for name in web runner tunnel-web tunnel-runner; do
    if [ -f "$STATE/$name.pid" ]; then
      local pid
      pid=$(cat "$STATE/$name.pid")
      # ปิดทั้ง process และลูก (npm/next เปิด process ย่อย)
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
      rm -f "$STATE/$name.pid"
    fi
  done
  rm -f "$STATE/info.txt"
}

print_info() {
  [ -f "$STATE/info.txt" ] || die "ยังไม่ได้ start"
  cat "$STATE/info.txt"
}

cmd_start() {
  command -v cloudflared >/dev/null || die "ไม่พบ cloudflared — ติดตั้งด้วย: brew install cloudflared"
  [ -f "$STATE/web.pid" ] && die "เปิดอยู่แล้ว (scripts/share.sh status ดู URL หรือ stop ก่อน)"
  for p in $WEB_PORT $RUNNER_PORT; do
    port_busy "$p" && die "พอร์ต $p ถูกใช้อยู่ — ปิด npm run dev:web / dev:runner ก่อน"
  done

  log "เปิด Docker และ Postgres"
  docker info >/dev/null 2>&1 || colima start >/dev/null
  (cd "$ROOT" && docker compose up -d --wait db >/dev/null)

  log "build (core, db, runner และหน้าเว็บ)"
  (cd "$ROOT" && npm run build >"$STATE/build.log" 2>&1) || die "build ไม่ผ่าน ดู .share/build.log"
  (cd "$ROOT" && npm run build -w @test-studio/web >>"$STATE/build.log" 2>&1) || die "build หน้าเว็บไม่ผ่าน ดู .share/build.log"

  log "เปิด Cloudflare tunnel"
  start_bg tunnel-web "$ROOT" cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$WEB_PORT"
  start_bg tunnel-runner "$ROOT" cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$RUNNER_PORT"
  local web_url runner_url
  web_url=$(tunnel_url "$STATE/tunnel-web.log") || { stop_all; die "ขอ URL ของ tunnel หน้าเว็บไม่ได้ ดู .share/tunnel-web.log"; }
  runner_url=$(tunnel_url "$STATE/tunnel-runner.log") || { stop_all; die "ขอ URL ของ tunnel runner ไม่ได้ ดู .share/tunnel-runner.log"; }

  local password=${ACCESS_PASSWORD:-$(random_secret 6)}
  local token_secret
  token_secret=$(random_secret 32)

  log "เปิด runner และหน้าเว็บ"
  # ค่าที่ส่งผ่าน environment ทับค่าใน .env / .env.local (ทั้ง runner และ Next ไม่เขียนทับค่าที่ตั้งไว้แล้ว)
  start_bg runner "$ROOT/apps/runner" env HOST=127.0.0.1 PORT=$RUNNER_PORT APP_PORT=$WEB_PORT \
    RUNNER_TOKEN_SECRET="$token_secret" ALLOWED_ORIGINS="$web_url" PUBLIC_APP_URL="$web_url" BACKUP_DIR="$ROOT/backups" RUN_MIGRATIONS=true node dist/main.js
  start_bg web "$ROOT/apps/web" env NODE_ENV=production ALLOW_ANONYMOUS_DEV_USER=true ACCESS_PASSWORD="$password" \
    RUNNER_TOKEN_SECRET="$token_secret" RUNNER_WS_URL="${runner_url/https:/wss:}/ws" npx next start -p $WEB_PORT

  wait_http "http://127.0.0.1:$RUNNER_PORT/healthz" || { stop_all; die "runner ไม่ขึ้น ดู .share/runner.log"; }
  wait_http "http://127.0.0.1:$WEB_PORT/api/health" || { stop_all; die "หน้าเว็บไม่ขึ้น ดู .share/web.log"; }
  log "รอให้ tunnel พร้อม (ครั้งแรกอาจใช้เวลาสักครู่)"
  wait_http "$web_url/api/health" || log "tunnel หน้าเว็บยังตอบไม่ได้ ลองเปิดอีกครั้งในอีกสักครู่"
  wait_http "$runner_url/healthz" || log "tunnel runner ยังตอบไม่ได้ ลองเปิดอีกครั้งในอีกสักครู่"

  cat >"$STATE/info.txt" <<EOF
Test Studio (เปิดให้ทีมลองใช้)
  URL:        $web_url
  รหัสผ่าน:    $password  (ใส่ในหน้าเข้าสู่ระบบ จำไว้ 7 วัน)
  runner:     ${runner_url/https:/wss:}/ws  (หน้าเว็บต่อให้เอง ไม่ต้องแจก)
  เริ่มเมื่อ:    $(date '+%Y-%m-%d %H:%M')
ปิด: scripts/share.sh stop
EOF
  chmod 600 "$STATE/info.txt"
  print_info
}

cmd_status() {
  print_info
  for name in tunnel-web tunnel-runner runner web; do
    if [ -f "$STATE/$name.pid" ] && kill -0 "$(cat "$STATE/$name.pid")" 2>/dev/null; then echo "  $name: ทำงานอยู่"; else echo "  $name: ไม่ทำงาน"; fi
  done
}

case "${1:-}" in
  start) cmd_start ;;
  stop) stop_all; log "ปิดแล้ว (Postgres ยังเปิดอยู่: npm run db:up / docker compose stop db)" ;;
  status) cmd_status ;;
  *) echo "ใช้: scripts/share.sh start | stop | status"; exit 1 ;;
esac
