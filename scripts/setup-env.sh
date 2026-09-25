#!/usr/bin/env bash
# 개발/배포 공통 환경 설정. 실제 로직은 OS 공통인 scripts/setup.mjs에 있다.
# 사용법: scripts/setup-env.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v node >/dev/null 2>&1 || { echo "Node.js가 필요합니다 (>=26)." >&2; exit 1; }
exec node "$ROOT/scripts/setup.mjs"
