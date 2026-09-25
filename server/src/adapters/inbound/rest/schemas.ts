import { z } from "zod";

import { InvalidRequest } from "../../../domain/errors";

export const submitBody = z.object({
  query: z.string(),
  providers: z.array(z.string()).optional(),
});

export const bulkBody = z.object({
  queries: z.array(z.string()),
  providers: z.array(z.string()).optional(),
});

export const addProvidersBody = z.object({ providers: z.array(z.string()) });

export const askBody = z.object({
  question: z.string(),
  providers: z.array(z.string()).optional(),
});

export const systemPromptBody = z.object({ content: z.string() });

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
