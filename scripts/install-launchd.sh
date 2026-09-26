#!/usr/bin/env bash
# query 서버를 macOS launchd(LaunchAgent)로 등록한다.
# 사용법: scripts/install-launchd.sh [--no-start]
# 서버는 단일 프로세스로 실행해야 한다(확장 접속 상태를 메모리에 두므로).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-$ROOT}"
LABEL="kr.xcv.query"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
START=1
[ "${1:-}" = "--no-start" ] && START=0

[ "$(uname)" = "Darwin" ] || { echo "macOS 전용입니다. Linux는 install-systemd.sh를 사용하세요." >&2; exit 1; }
[ -f "$APP_DIR/server/dist/main.js" ] || { echo "빌드 결과가 없습니다. 먼저 scripts/setup-env.sh 실행" >&2; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo ".env가 없습니다." >&2; exit 1; }
NODE_BIN="$(command -v node)"
[ -n "$NODE_BIN" ] || { echo "node를 찾을 수 없습니다." >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$APP_DIR/user/logs"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$APP_DIR/server/dist/main.js</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$APP_DIR/user/logs/query.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/user/logs/query.err.log</string>
</dict>
</plist>
PLIST

DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "$START" -eq 1 ]; then
  launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl kickstart -k "$DOMAIN/$LABEL"
  echo "등록/시작 완료 ($LABEL). 로그: $APP_DIR/user/logs/query.log"
else
  echo "등록 파일만 생성했습니다: $PLIST"
fi
