#!/usr/bin/env bash
# query systemd **user** 유닛 등록 (Linux, root 불필요). GitHub Actions 배포(`systemctl --user restart query`)가 이 유닛을 재시작한다.
# 사용법: scripts/install-systemd-user.sh [--no-start]
# 사전 조건: `loginctl enable-linger $USER`(로그아웃 후에도 유지), 빌드 결과(server/dist)와 .env
# 서버는 단일 프로세스로 실행해야 한다(확장 접속 상태를 메모리에 두므로).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-$ROOT}"
UNIT_NAME="query"
START=1
[ "${1:-}" = "--no-start" ] && START=0

[ -f "$APP_DIR/server/dist/main.js" ] || { echo "빌드 결과가 없습니다. 먼저 scripts/setup-env.sh 실행" >&2; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo ".env가 없습니다." >&2; exit 1; }
NODE_BIN="$(command -v node)"
[ -n "$NODE_BIN" ] || { echo "node를 찾을 수 없습니다." >&2; exit 1; }

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR" "$APP_DIR/user/logs"

cat > "$UNIT_DIR/$UNIT_NAME.service" <<UNIT
[Unit]
Description=Query server (REST + Web UI + MCP + extension WebSocket)

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/server/dist/main.js
Restart=always
RestartSec=3
NoNewPrivileges=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$UNIT_NAME

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable "$UNIT_NAME"
if [ "$START" -eq 1 ]; then
  systemctl --user restart "$UNIT_NAME"
  systemctl --user --no-pager status "$UNIT_NAME" | head -n 12 || true
fi
echo "등록 완료 (unit=$UNIT_NAME, node=$NODE_BIN). 로그: journalctl --user -u $UNIT_NAME"
