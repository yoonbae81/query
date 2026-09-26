import { z } from "zod";

import type { ClientMessage } from "../../../../../protocol";

/** 확장 → 서버 메시지의 런타임 검증. 루트 protocol.ts의 ClientMessage와 일치해야 한다(아래 satisfies). */
const providerState = z.enum(["ready", "login_required", "no_tab"]);
const shortId = z.string().min(1).max(128);
const providerEntry = z.object({ id: shortId, state: providerState });
const providerList = z.array(providerEntry).max(16);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    client_id: shortId,
    version: z.string().max(64),
    providers: providerList,
  }),
  z.object({ type: z.literal("state"), providers: providerList }),
  z.object({ type: z.literal("claim"), provider: shortId }),
  z.object({ type: z.literal("progress"), result_id: shortId, message: z.string().max(2000) }),
  z.object({
    type: z.literal("result"),
    result_id: shortId,
    answer: z.string().max(1_000_000),
    citations: z.array(z.string().max(2048)).max(200),
  }),
  z.object({
    type: z.literal("error"),
    result_id: shortId,
    code: z.enum(["login_required", "timeout", "selector_missing", "retryable"]),
    message: z.string().max(2000),
  }),
  z.object({ type: z.literal("ping") }),
]) satisfies z.ZodType<ClientMessage>;
