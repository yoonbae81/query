import { InvalidRequest } from "./errors";

export const DEFAULT_CATEGORY = "general";

// 카테고리는 프롬프트 파일명(user/prompts/<category>.md)으로도 쓰이므로 경로 문자와 점을 허용하지 않는다.
const CATEGORY_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u;

// Windows 예약 장치명은 파일명으로 쓸 수 없다
const RESERVED = new Set(["con", "prn", "aux", "nul", ...Array.from({ length: 9 }, (_, i) => [`com${i + 1}`, `lpt${i + 1}`]).flat()]);

/** 입력을 소문자로 정규화하고 검증한다. 비어 있으면 기본 카테고리(general)를 돌려준다. */
export function normalizeCategory(input: string | undefined | null): string {
  const category = (input ?? "").trim().toLowerCase();
  if (!category) return DEFAULT_CATEGORY;
  if (!CATEGORY_RE.test(category) || RESERVED.has(category)) {
    throw new InvalidRequest("카테고리는 글자·숫자·-·_ 로 이루어진 32자 이내여야 합니다.");
  }
  return category;
}

export function isValidCategory(input: string): boolean {
  try {
    return normalizeCategory(input) === input;
  } catch {
    return false;
  }
}
