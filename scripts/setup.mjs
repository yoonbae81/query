// 개발/배포 공통 환경 설정 (Windows/macOS/Linux): 의존성 설치, 빌드, user/ 디렉터리, .env
// 사용법: node scripts/setup.mjs   (또는 npm run setup)
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const major = Number(process.versions.node.split(".")[0]);
if (major < 26) {
  console.error(`Node.js 26 이상이 필요합니다 (현재 v${process.versions.node}).`);
  process.exit(1);
}

// Windows에서 npm은 npm.cmd라 shell을 통해 실행한다
function npm(...args) {
  const r = spawnSync(["npm", ...args].join(" "), { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`실패: npm ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

console.log("==> 의존성 설치");
for (const dir of ["server", "server/web", "extension"]) {
  npm("--prefix", dir, existsSync(resolve(dir, "package-lock.json")) ? "ci" : "install");
}

console.log("==> 빌드");
npm("--prefix", "server/web", "run", "build");
npm("--prefix", "server", "run", "build");
npm("--prefix", "extension", "run", "build");

console.log("==> user/ 디렉터리 준비");
for (const dir of ["user/config", "user/answers", "user/logs"]) mkdirSync(dir, { recursive: true });
const promptFile = "user/config/system_prompt.md";
if (!existsSync(promptFile)) writeFileSync(promptFile, "간결하고 정확하게 답변하고, 출처를 명시하세요.\n", "utf8");

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  try {
    chmodSync(".env", 0o600);
  } catch {
    /* Windows 등 권한 변경을 지원하지 않는 환경 */
  }
  console.log("==> .env 생성 (.env.example 복사)");
}

console.log(`
완료. 다음 단계:
  개발 실행:     npm run dev              (server: http://127.0.0.1:8000)
  서비스 등록:   sudo scripts/install-systemd.sh  (Linux)  또는  scripts/install-launchd.sh  (macOS)
  확장 설치:     브라우저 확장 관리 → 개발자 모드 → '압축해제된 확장 로드' → ${resolve("extension/dist")}`);
