"""Gmail OAuth 설정을 터미널에서 단계별로 안내하며 진행하고, 결과를 .env에 저장한다.

사용법:
  python scripts/gmail_oauth.py [--credentials PATH] [--token PATH] [--no-browser] [--port 8080]

  --no-browser  브라우저를 자동으로 열지 않고 URL만 출력 (원격 서버용)
  --port        OAuth 콜백 포트 (기본: 실행 중 선택. 원격 서버는 8080 등 고정 권장)
"""
import argparse
import shutil
import sys
from pathlib import Path

from dotenv import dotenv_values, set_key
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
TOTAL = 5


def step(n: int, title: str) -> None:
    print(f"\n[{n}/{TOTAL}] {title}")
    print("-" * 60)


def wait(msg: str = "완료되면 Enter를 누르세요...") -> None:
    input(f"\n>> {msg}")


def ask(msg: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    return input(f">> {msg}{suffix}: ").strip() or default


def confirm(msg: str, default: bool = True) -> bool:
    hint = "Y/n" if default else "y/N"
    answer = input(f">> {msg} ({hint}): ").strip().lower()
    return default if not answer else answer in ("y", "yes")


def step_console_guide() -> None:
    step(1, "Google Cloud 프로젝트 준비 및 Gmail API 활성화")
    print("""\
  1) https://console.cloud.google.com/ 접속 (Perplexity 인증 메일을 받는 Gmail 계정으로 로그인)
  2) 상단 프로젝트 선택 > '새 프로젝트' 생성 (이름 예: query)
  3) https://console.cloud.google.com/apis/library/gmail.googleapis.com 접속
     > 프로젝트를 위에서 만든 것으로 선택 > '사용' 클릭""")
    wait()

    step(2, "OAuth 동의 화면 구성")
    print("""\
  1) https://console.cloud.google.com/apis/credentials/consent 접속
  2) 사용자 유형: '외부(External)' 선택 > 앱 이름/지원 이메일/개발자 연락처 입력 후 저장
  3) '대상(Audience)' 또는 '테스트 사용자' 항목에서 'Add users'로 본인 Gmail 주소 추가
     (게시 상태가 '테스트'이면 추가한 계정만 로그인 가능. 테스트 상태의 토큰은 7일 후 만료될 수
      있으니 '프로덕션으로 게시'를 하면 만료되지 않습니다. 본인만 쓰는 앱이면 미검수 게시로 충분)""")
    wait()

    step(3, "OAuth 클라이언트 ID 생성 (Desktop app) 및 JSON 다운로드")
    print("""\
  1) https://console.cloud.google.com/apis/credentials 접속
  2) '사용자 인증 정보 만들기' > 'OAuth 클라이언트 ID'
  3) 애플리케이션 유형: '데스크톱 앱' 선택 > 이름 입력 > 만들기
  4) 팝업에서 'JSON 다운로드' 클릭 (client_secret_XXXX.json)""")
    wait()


def step_place_credentials(cred_path: Path) -> bool:
    step(4, f"OAuth 클라이언트 JSON 배치 (대상: {cred_path})")
    if cred_path.exists() and not confirm("이미 파일이 있습니다. 그대로 사용할까요?"):
        cred_path.unlink()
    while not cred_path.exists():
        src = ask("다운로드한 JSON 파일 경로를 붙여넣으세요 (취소하려면 q)")
        if src.lower() == "q":
            return False
        src_path = Path(src.strip("\"'")).expanduser()
        if not src_path.is_file():
            print(f"   파일을 찾을 수 없습니다: {src_path}")
            continue
        cred_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src_path, cred_path)
        cred_path.chmod(0o600)
        print(f"   복사 완료: {cred_path}")
    print("   OK")
    return True


def step_authorize(cred_path: Path, no_browser: bool, port: int):
    step(5, "Google 계정 동의 (gmail.readonly)")
    if not no_browser:
        no_browser = not confirm("이 PC에서 브라우저를 자동으로 열까요? (원격 서버면 n)")
    if no_browser:
        port = port or int(ask("콜백 포트", "8080"))
        print(f"""\
  원격 서버에서 실행 중이라면, 로컬 PC의 다른 터미널에서 먼저 포트를 포워딩하세요:
    ssh -L {port}:localhost:{port} <서버>
  그 다음 아래에 출력되는 URL을 로컬 PC의 브라우저에서 여세요.
  '확인되지 않은 앱' 경고가 나오면 '고급' > '(앱 이름)(안전하지 않음)으로 이동'을 선택하세요.""")
    else:
        print("  브라우저가 열리면 계정을 선택하고 '허용'을 누르세요. (경고가 나오면 '고급' > 이동)")
    flow = InstalledAppFlow.from_client_secrets_file(str(cred_path), SCOPES)
    return flow.run_local_server(port=port, open_browser=not no_browser)


def main() -> int:
    env = dotenv_values(ENV_FILE) if ENV_FILE.exists() else {}
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--credentials", default=env.get("GMAIL_OAUTH_CREDENTIALS_PATH") or "user/config/gmail_credentials.json")
    ap.add_argument("--token", default=env.get("GMAIL_OAUTH_TOKEN_PATH") or "user/sessions/gmail_token.json")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--port", type=int, default=0)
    args = ap.parse_args()

    cred_path = (ROOT / args.credentials).resolve()
    token_path = (ROOT / args.token).resolve()

    print("=== Gmail OAuth 설정 (Perplexity 인증번호 조회용, 읽기 전용) ===")
    if cred_path.exists():
        print(f"\n클라이언트 JSON이 이미 있습니다: {cred_path}")
        if not confirm("Google Cloud 설정 안내(1~3단계)를 건너뛸까요?"):
            step_console_guide()
    else:
        step_console_guide()

    if not step_place_credentials(cred_path):
        print("취소했습니다.")
        return 1

    creds = step_authorize(cred_path, args.no_browser, args.port)

    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(creds.to_json(), encoding="utf-8")
    token_path.chmod(0o600)
    email = build("gmail", "v1", credentials=creds).users().getProfile(userId="me").execute()["emailAddress"]

    if not ENV_FILE.exists():
        ENV_FILE.touch()
    updates = {
        "GMAIL_OAUTH_CREDENTIALS_PATH": args.credentials,
        "GMAIL_OAUTH_TOKEN_PATH": args.token,
        "GMAIL_ACCOUNT_EMAIL": email,
    }
    if not env.get("PERPLEXITY_LOGIN_EMAIL") and confirm(f"Perplexity 로그인 이메일도 {email} 로 저장할까요?"):
        updates["PERPLEXITY_LOGIN_EMAIL"] = email
    for key, value in updates.items():
        set_key(str(ENV_FILE), key, value, quote_mode="never")

    print(f"\n완료: {email}")
    print(f"  토큰 저장: {token_path}")
    print(f"  .env 갱신: {', '.join(updates)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (KeyboardInterrupt, EOFError):
        print("\n중단했습니다.")
        sys.exit(130)
