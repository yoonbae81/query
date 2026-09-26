import { z } from "zod";

import { InvalidRequest } from "../../../domain/errors";

// 입력 검증 (ASVS V2.2.1): 알 수 없는 필드 거부, 길이·개수 상한. 도메인 규칙(질문 길이 등)은 유스케이스가 다시 검사한다.
const text = z.string().max(100_000);
const providers = z.array(z.string().max(64)).max(16);

export const submitBody = z.strictObject({
  query: text,
  providers: providers.optional(),
});

export const bulkBody = z.strictObject({
  queries: z.array(text).max(100),
  providers: providers.optional(),
});

export const addProvidersBody = z.strictObject({ providers });

export const askBody = z.strictObject({
  question: text,
  providers: providers.optional(),
});

export const systemPromptBody = z.strictObject({ content: z.string().max(50_000) });

/** zod 검증 실패를 공통 에러 포맷(400 INVALID_REQUEST)으로 변환한다. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (r.success) return r.data;
  const detail = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
  throw new InvalidRequest(detail);
}

/** 선택적 숫자 쿼리 파라미터. 값이 있는데 숫자가 아니면 400 */
export function numberParam(name: string, value: unknown): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new InvalidRequest(`${name}는 숫자여야 합니다.`);
  return n;
}
