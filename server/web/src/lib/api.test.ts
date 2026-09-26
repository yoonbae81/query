import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { getToken, setToken } from "./auth";

afterEach(() => {
  vi.restoreAllMocks();
  setToken("");
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("API 토큰", () => {
  it("저장된 토큰을 Bearer 헤더로 보낸다", async () => {
    setToken("secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { providers: [] }));
    await api.providers();
    const headers = fetchMock.mock.calls[0]![1]!.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer secret");
  });

  it("401이면 토큰을 물어 저장하고 한 번 다시 시도한다", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(" tok ");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(401, { error: { message: "인증이 필요합니다." } }))
      .mockResolvedValueOnce(json(200, { providers: [] }));
    await expect(api.providers()).resolves.toEqual([]);
    expect(getToken()).toBe("tok");
    expect((fetchMock.mock.calls[1]![1]!.headers as Headers).get("Authorization")).toBe("Bearer tok");
  });

  it("다시 시도해도 401이면 저장한 토큰을 지우고 오류를 낸다", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("wrong");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json(401, { error: { message: "인증이 필요합니다." } }));
    await expect(api.providers()).rejects.toThrow("인증이 필요합니다.");
    expect(getToken()).toBe("");
  });
});
