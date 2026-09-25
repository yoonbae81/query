import type { Container } from "./container";

const HOUR_MS = 60 * 60 * 1000;
const WAKE_CHECK_MS = 5000;

/**
 * API 프로세스의 주기 작업 (PLAN2 §4.4): 임대 회수, TTL 정리, 재시도 대기가 끝난 작업 wake.
 * 반환된 함수를 호출하면 모든 타이머를 멈춘다.
 */
export function startBackground(c: Container, log: (message: string) => void = console.log): () => void {
  const guard = (name: string, fn: () => Promise<void>) => {
    let running = false;
    return async () => {
      if (running) return;
      running = true;
      try {
        await fn();
      } catch (e) {
        log(`${name} 실패: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        running = false;
      }
    };
  };

  const sweep = guard("임대 회수", async () => {
    const n = await c.sweepLeases.execute();
    if (n > 0) {
      log(`만료된 임대 ${n}건 회수`);
      c.hub.wake();
    }
  });
  const cleanup = guard("정리", async () => {
    const n = await c.cleanup.execute();
    if (n > 0) log(`만료 결과 ${n}건 정리`);
  });
  const wake = guard("wake", async () => {
    if ((await c.repo.countClaimable(new Date())) > 0) c.hub.wake();
  });

  void cleanup();
  const timers = [
    setInterval(sweep, c.settings.leaseSweepIntervalSeconds * 1000),
    setInterval(cleanup, c.settings.cleanupIntervalHours * HOUR_MS),
    setInterval(wake, WAKE_CHECK_MS),
  ];
  return () => timers.forEach(clearInterval);
}
