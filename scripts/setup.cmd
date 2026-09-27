@echo off
setlocal
cd /d "%~dp0\.."

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [오류] Node.js를 찾을 수 없습니다. Node.js 26 이상을 설치해주세요.
    pause
    exit /b 1
)

echo [초기설정] Query 환경 설정을 진행합니다...
node "%~dp0setup.mjs"
if %errorlevel% neq 0 (
    echo [오류] 설정 중 오류가 발생했습니다.
    pause
    exit /b %errorlevel%
)
pause
