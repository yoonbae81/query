import { z } from "zod";

import type { ClientMessage } from "../../../../../protocol";

/** 확장 → 서버 메시지의 런타임 검증. 루트 protocol.ts의 ClientMessage와 일치해야 한다(아래 satisfies). */
const providerState = z.enum(["ready", "login_required", "no_tab"]);
const providerEntry = z.object({ id: z.string().min(1), state: providerState });

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    client_id: z.string().min(1),
    version: z.string(),
    providers: z.array(providerEntry),
  }),
  z.object({ type: z.literal("state"), providers: z.array(providerEntry) }),
  z.object({ type: z.literal("claim"), provider: z.string().min(1) }),
  z.object({ type: z.literal("progress"), result_id: z.string().min(1), message: z.string() }),
  z.object({
    type: z.literal("result"),
    result_id: z.string().min(1),
    answer: z.string(),
    citations: z.array(z.string()),
  }),
  z.object({
    type: z.literal("error"),
    result_id: z.string().min(1),
    code: z.enum(["login_required", "timeout", "selector_missing", "retryable"]),
    message: z.string(),
  }),
  z.object({ type: z.literal("ping") }),
]) satisfies z.ZodType<ClientMessage>;
