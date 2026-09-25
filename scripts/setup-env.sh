#!/usr/bin/env bash
# 개발/배포 공통 환경 설정: venv, 의존성, Playwright, user/ 디렉터리, .env
# 사용법: scripts/setup-env.sh [--with-deps]   (--with-deps: Linux에서 Chromium 시스템 라이브러리 설치, sudo 필요)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python

if [ ! -d .venv ]; then
  echo "==> .venv 생성"
  "$PYTHON" -m venv .venv
fi

if [ -x .venv/bin/python ]; then VPY=.venv/bin/python; else VPY=.venv/Scripts/python; fi

echo "==> 의존성 설치"
"$VPY" -m pip install -U pip -q
"$VPY" -m pip install -r requirements.txt -q

echo "==> Playwright Chromium 설치"
if [ "${1:-}" = "--with-deps" ]; then
  "$VPY" -m playwright install --with-deps chromium
else
  "$VPY" -m playwright install chromium
fi

echo "==> user/ 디렉터리 준비"
mkdir -p user/config user/sessions user/answers
if [ ! -f user/config/system_prompt.md ]; then
  printf '%s\n' "간결하고 정확하게 답변하고, 출처를 명시하세요." > user/config/system_prompt.md
fi
chmod 700 user/sessions

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "==> .env 생성 (.env.example 복사). PERPLEXITY_LOGIN_EMAIL 등을 채우세요."
fi

cat <<MSG

완료. 다음 단계:
  1. user/config/gmail_credentials.json 에 Google OAuth 클라이언트 JSON 배치
  2. $VPY scripts/gmail_oauth.py
  3. (배포 서버) sudo scripts/install-systemd.sh
MSG
