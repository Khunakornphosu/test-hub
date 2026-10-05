#!/usr/bin/env bash
# กู้คืนฐานข้อมูลจากไฟล์สำรอง: npm run db:restore -- backups/test-studio-2026-10-05_0300.sql.gz --yes
# ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่ด้วยข้อมูลในไฟล์ จึงสำรองข้อมูลปัจจุบันไว้ก่อนทุกครั้ง
# ใช้ DATABASE_URL และ BACKUP_DOCKER_CONTAINER จาก apps/runner/.env (หรือ environment)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
die() { printf '\033[31m[restore] %s\033[0m\n' "$*" >&2; exit 1; }
log() { printf '\033[1m[restore]\033[0m %s\n' "$*"; }

file="" confirmed=false
for arg in "$@"; do
  case "$arg" in
    --yes) confirmed=true ;;
    -*) die "ไม่รู้จักตัวเลือก $arg" ;;
    *) file="$arg" ;;
  esac
done
[ -n "$file" ] || die "ใช้: npm run db:restore -- <ไฟล์ .sql.gz> --yes"
[ -f "$file" ] || die "ไม่พบไฟล์ $file"
gzip -t "$file" 2>/dev/null || die "$file ไม่ใช่ไฟล์ gzip ที่สมบูรณ์"
$confirmed || die "การกู้คืนจะแทนที่ข้อมูลปัจจุบันทั้งหมดด้วยข้อมูลใน $(basename "$file") — ถ้าแน่ใจให้เพิ่ม --yes"

if [ -f "$ROOT/apps/runner/.env" ]; then
  # อ่านเฉพาะค่าที่ต้องใช้ ไม่ทับค่าที่ตั้งไว้ใน environment แล้ว
  while IFS='=' read -r key value; do
    case "$key" in DATABASE_URL|BACKUP_DOCKER_CONTAINER) [ -z "${!key:-}" ] && export "$key=$value" ;; esac
  done < <(grep -E '^(DATABASE_URL|BACKUP_DOCKER_CONTAINER)=' "$ROOT/apps/runner/.env")
fi
[ -n "${DATABASE_URL:-}" ] || die "ต้องตั้ง DATABASE_URL"

log "สำรองข้อมูลปัจจุบันก่อนกู้คืน"
(cd "$ROOT" && npm run --silent db:backup) || die "สำรองข้อมูลปัจจุบันไม่สำเร็จ จึงไม่กู้คืน"

# แยก user/ฐานข้อมูลจาก URL (postgres://user:pass@host:port/db)
user=$(node -e 'const u=new URL(process.argv[1]);console.log(decodeURIComponent(u.username))' "$DATABASE_URL")
db=$(node -e 'const u=new URL(process.argv[1]);console.log(decodeURIComponent(u.pathname.slice(1)))' "$DATABASE_URL")

log "กู้คืนจาก $(basename "$file")"
if [ -n "${BACKUP_DOCKER_CONTAINER:-}" ]; then
  gunzip -c "$file" | docker exec -i "$BACKUP_DOCKER_CONTAINER" psql -q -v ON_ERROR_STOP=1 -U "$user" -d "$db" >/dev/null
else
  eval "$(node -e 'const u=new URL(process.argv[1]);for (const [k,v] of [["PGHOST",u.hostname],["PGPORT",u.port||"5432"],["PGUSER",decodeURIComponent(u.username)],["PGPASSWORD",decodeURIComponent(u.password)],["PGDATABASE",decodeURIComponent(u.pathname.slice(1))]]) console.log(`export ${k}=${JSON.stringify(v)}`)' "$DATABASE_URL")"
  gunzip -c "$file" | psql -q -v ON_ERROR_STOP=1 >/dev/null
fi
log "กู้คืนเรียบร้อย — รีสตาร์ท runner และหน้าเว็บเพื่อให้ใช้ข้อมูลใหม่"
