import { SiteError } from "../../../../domain/model";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function queryFirst<T extends Element = Element>(selectors: readonly string[], root: ParentNode = document): T | null {
  for (const selector of selectors) {
    const el = root.querySelector<T>(selector);
    if (el) return el;
  }
  return null;
}

export function queryAll<T extends Element = Element>(selectors: readonly string[], root: ParentNode = document): T[] {
  for (const selector of selectors) {
    const found = [...root.querySelectorAll<T>(selector)];
    if (found.length > 0) return found;
  }
  return [];
}

/** 조건이 참(값 반환)이 될 때까지 폴링한다. 시간 내 못 얻으면 timeoutError()를 던진다. */
export async function waitFor<T>(
  fn: () => T | null | undefined | false,
  opts: { timeoutMs: number; intervalMs?: number; timeoutError: () => Error },
): Promise<T> {
  const interval = opts.intervalMs ?? 200;
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() >= deadline) throw opts.timeoutError();
    await sleep(interval);
  }
}

export interface StableTextOptions {
  /** 시작 후 최소 대기 (PLAN §6.3 고정 대기) */
  minWaitMs: number;
  /** 이 시간 동안 텍스트 변화가 없으면 완료로 간주 */
  stableMs: number;
  timeoutMs: number;
  intervalMs: number;
  /** true인 동안은 생성 중으로 보고 완료 판정을 미룬다 (예: 중지 버튼이 보임) */
  isBusy?: () => boolean;
}

/** 텍스트가 비어 있지 않고 stableMs 동안 변하지 않으며 busy가 아닐 때까지 기다린다 (PLAN §6.3). */
export async function waitForStableText(getText: () => string, o: StableTextOptions): Promise<string> {
  const started = Date.now();
  let last = "";
  let lastChange = Date.now();
  for (;;) {
    const text = getText();
    const now = Date.now();
    if (text !== last) {
      last = text;
      lastChange = now;
    }
    const busy = o.isBusy?.() ?? false;
    if (busy) lastChange = now;
    if (now - started >= o.minWaitMs && last.trim() !== "" && !busy && now - lastChange >= o.stableMs) return last;
    if (now - started >= o.timeoutMs) throw new SiteError("timeout", "답변 생성이 시간 내에 끝나지 않았습니다.");
    await sleep(o.intervalMs);
  }
}
