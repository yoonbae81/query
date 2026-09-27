#!/usr/bin/env bash
# query systemd 서비스 등록 (Linux). 기본은 user 모드(root 불필요)로 등록합니다.
# 사용법: scripts/install-systemd.sh [--no-start] [--system]
#   기본(user 모드): ~/.config/systemd/user/query.service 에 등록 (systemctl --user)
#   --system: /etc/systemd/system/query.service 에 시스템 서비스로 등록 (sudo 필요)
# 사전 조건: loginctl enable-linger $USER (로그아웃 후에도 상주), 빌드 결과(server/dist)와 .env
# 서버는 단일 프로세스로 실행해야 한다(확장 접속 상태를 메모리에 두므로, PLAN2 §4.4).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-$ROOT}"
UNIT_NAME="query"
START=1
MODE="user"

while [ $# -gt 0 ]; do
  case "$1" in
    --system) MODE="system"; shift ;;
    --user) MODE="user"; shift ;;
    --no-start) START=0; shift ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

[ -f "$APP_DIR/server/dist/main.js" ] || { echo "빌드 결과가 없습니다. 먼저 scripts/setup.cmd 또는 scripts/setup.sh 실행" >&2; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo ".env가 없습니다." >&2; exit 1; }

if [ "$MODE" = "system" ]; then
  [ "$(id -u)" -eq 0 ] || { echo "시스템 모드는 root 권한이 필요합니다 (sudo)." >&2; exit 1; }
  SVC_USER="${SUDO_USER:-root}"
  NODE_BIN="$(sudo -u "$SVC_USER" bash -lc "command -v node" 2>/dev/null || command -v node)"
  [ -n "$NODE_BIN" ] || { echo "node를 찾을 수 없습니다." >&2; exit 1; }

  chown -R "$SVC_USER":"$SVC_USER" "$APP_DIR/user" 2>/dev/null || true
  UNIT_FILE="/etc/systemd/system/$UNIT_NAME.service"

  cat > "$UNIT_FILE" <<UNIT
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
  systemctl enable "$UNIT_NAME"
  if [ "$START" -eq 1 ]; then
    systemctl restart "$UNIT_NAME"
    systemctl --no-pager status "$UNIT_NAME" | head -n 12 || true
  fi
  echo "시스템 서비스 등록 완료 (unit=$UNIT_NAME, user=$SVC_USER). 로그: journalctl -u $UNIT_NAME"

else
  # 기본: user 모드 (root 불필요)
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
  echo "사용자 서비스 등록 완료 (unit=$UNIT_NAME, node=$NODE_BIN). 로그: journalctl --user -u $UNIT_NAME"
fi
