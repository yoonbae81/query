#!/usr/bin/env bash
# query-api systemd 유닛 생성·등록 (Linux, root 필요)
# 사용법: sudo scripts/install-systemd.sh [--user USER] [--no-start]
#  APP_DIR 기본값: 이 스크립트가 속한 저장소 루트 (예: /opt/query)
# 서버는 단일 프로세스로 실행해야 한다(확장 접속 상태를 메모리에 두므로).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-$ROOT}"
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
[ -f "$APP_DIR/server/dist/main.js" ] || { echo "빌드 결과가 없습니다. 먼저 scripts/setup-env.sh 실행" >&2; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo ".env가 없습니다." >&2; exit 1; }
NODE_BIN="$(sudo -u "$SVC_USER" bash -lc 'command -v node')"
[ -n "$NODE_BIN" ] || { echo "node를 찾을 수 없습니다." >&2; exit 1; }

chown -R "$SVC_USER":"$SVC_USER" "$APP_DIR/user" 2>/dev/null || true

# 이전 구조(Python)의 worker 유닛이 남아 있으면 제거
if [ -f /etc/systemd/system/query-worker.service ]; then
  systemctl disable --now query-worker 2>/dev/null || true
  rm -f /etc/systemd/system/query-worker.service
fi

cat > /etc/systemd/system/query-api.service <<UNIT
[Unit]
Description=Query server (REST + Web UI + MCP + extension WebSocket)
After=network.target

[Service]
Type=simple
User=$SVC_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/server/dist/main.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable query-api
if [ "$START" -eq 1 ]; then
  systemctl restart query-api
  systemctl --no-pager status query-api | head -n 12 || true
fi
echo "등록 완료 (user=$SVC_USER, node=$NODE_BIN)"
