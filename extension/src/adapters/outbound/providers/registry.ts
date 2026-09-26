import type { ProviderDescriptor } from "../../../domain/model";

/**
 * 지원 사이트 등록부. 순수 데이터라 빌드 스크립트와 코어가 함께 쓴다.
 * provider 추가 절차:
 *   1) providers/<id>/ 에 SiteProviderPort 구현 추가
 *   2) src/content/<id>.ts 콘텐츠 스크립트 진입점 추가
 *   3) 여기에 항목 추가 (빌드가 manifest의 권한/콘텐츠 스크립트를 자동 생성)
 *   4) 서버의 지원 provider 목록에 같은 id 추가
 */
export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    id: "perplexity",
    name: "Perplexity",
    matches: ["https://www.perplexity.ai/*", "https://perplexity.ai/*"],
    newThreadUrl: "https://www.perplexity.ai/",
  },
  {
    id: "claude",
    name: "Claude",
    matches: ["https://claude.ai/*"],
    newThreadUrl: "https://claude.ai/new",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    matches: ["https://chatgpt.com/*"],
    newThreadUrl: "https://chatgpt.com/",
  },
  {
    id: "gemini",
    name: "Gemini",
    matches: ["https://gemini.google.com/*"],
    newThreadUrl: "https://gemini.google.com/app",
  },
];
