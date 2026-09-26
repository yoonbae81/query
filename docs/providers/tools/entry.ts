/**
 * 검증 하네스용 번들 진입점. 각 사이트 모듈(Site)을 페이지에 주입해 실제 DOM에서 직접 실행하기 위한 것이다.
 * `harness.py bundle` 이 esbuild로 IIFE 번들(user/verify/sites.js)을 만든다.
 *
 * 새 provider를 추가하면 여기에 한 줄을 추가하고, harness.py의 PROVIDERS/TRACE_JS에도 항목을 추가한다.
 */
import { ChatGptSite } from "../../../extension/src/adapters/outbound/providers/chatgpt/chatgptSite";
import { ClaudeSite } from "../../../extension/src/adapters/outbound/providers/claude/claudeSite";
import { GeminiSite } from "../../../extension/src/adapters/outbound/providers/gemini/geminiSite";
import { PerplexitySite } from "../../../extension/src/adapters/outbound/providers/perplexity/perplexitySite";

(window as unknown as { __sites: Record<string, () => unknown> }).__sites = {
  claude: () => new ClaudeSite(),
  chatgpt: () => new ChatGptSite(),
  gemini: () => new GeminiSite(),
  perplexity: () => new PerplexitySite(),
};
