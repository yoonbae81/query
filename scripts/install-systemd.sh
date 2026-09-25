#!/usr/bin/env bash
# query-api / query-worker systemd 유닛 생성·등록 (root 필요)
# 사용법: sudo scripts/install-systemd.sh [--user USER] [--no-start]
#  APP_DIR 기본값: 이 스크립트가 속한 저장소 루트 (예: /opt/query)
#  API_APP 기본값: src.adapters.inbound.rest.app:app  (환경변수로 재정의 가능)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-$ROOT}"
API_APP="${API_APP:-src.adapters.inbound.rest.app:app}"
SVC_USER="${SUDO_USER:-root}"
START=1

while [ $# -gt 0 ]; do
  case "$1" in
    --user) SVC_USER="$2"; shift 2 ;;
    --no-start) START=0; shift ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "root 권한이 필요합니다 (sudo)." >&2; exit 1; }
[ -x "$APP_DIR/.venv/bin/python" ] || { echo ".venv가 없습니다. 먼저 scripts/setup-env.sh 실행" >&2; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo ".env가 없습니다." >&2; exit 1; }

# .env에서 호스트/포트/basePath 읽기
get() { grep -E "^$1=" "$APP_DIR/.env" | tail -n1 | cut -d= -f2- || true; }
HOST="$(get QUERY_HOST)"; HOST="${HOST:-127.0.0.1}"
PORT="$(get QUERY_PORT)"; PORT="${PORT:-8000}"
BASE_PATH="$(get BASE_PATH)"
ROOT_PATH_ARG=""
[ -n "$BASE_PATH" ] && ROOT_PATH_ARG=" --root-path $BASE_PATH"

chown -R "$SVC_USER":"$SVC_USER" "$APP_DIR/user" 2>/dev/null || true

cat > /etc/systemd/system/query-api.service <<UNIT
[Unit]
Description=Query API (REST + Web UI + MCP)
After=network.target

[Service]
Type=simple
User=$SVC_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/.venv/bin/uvicorn $API_APP --host $HOST --port $PORT$ROOT_PATH_ARG
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/query-worker.service <<UNIT
[Unit]
Description=Query Worker (Playwright)
After=network.target

[Service]
Type=simple
User=$SVC_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/.venv/bin/python -m src.worker
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable query-api query-worker
if [ "$START" -eq 1 ]; then
  systemctl restart query-api query-worker
  systemctl --no-pager status query-api query-worker | head -n 20 || true
fi
echo "등록 완료 (user=$SVC_USER, $HOST:$PORT${BASE_PATH:+, basePath=$BASE_PATH})"
