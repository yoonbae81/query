@echo off
setlocal
cd /d "%~dp0\.."

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [오류] Node.js를 찾을 수 없습니다. Node.js 26 이상을 설치해주세요.
    pause
    exit /b 1
)

if not exist ".env" (
    echo [알림] 환경 설정 파일(.env)이 없어 초기 설정을 실행합니다...
    call "%~dp0setup.cmd"
    if %errorlevel% neq 0 (
        echo [오류] 초기 설정 실패
        pause
        exit /b 1
    )
)

if not exist "server\dist\main.js" (
    echo [알림] 서버 빌드 파일이 없어 빌드를 진행합니다...
    call npm --prefix server run build
    if %errorlevel% neq 0 (
        echo [오류] 서버 빌드 실패
        pause
        exit /b 1
    )
)

echo [시작] Query 서버를 실행합니다... (종료: Ctrl+C)
node server\dist\main.js
if %errorlevel% neq 0 (
    pause
)
