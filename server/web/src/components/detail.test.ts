import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { router } from "../lib/router.svelte";
import { app } from "../lib/stores.svelte";
import { toast } from "../lib/toast.svelte";
import type { ProviderInfo, QueryDetail, ResultDetail } from "../lib/types";
import DeleteButton from "./DeleteButton.svelte";
import DetailPanel from "./DetailPanel.svelte";

const PROVIDERS: ProviderInfo[] = [
  { id: "perplexity", name: "Perplexity", available: true, online: true },
  { id: "claude", name: "Claude", available: true, online: true },
];

function result(over: Partial<ResultDetail> & { provider: string; result_id: string }): ResultDetail {
  return {
    status: "done",
    answer: `답변 ${over.provider}`,
    citations: [],
    progress_message: null,
    error_message: null,
    retry_count: 0,
    ...over,
  };
}

function detail(results: ResultDetail[]): QueryDetail {
  return { query_id: "q_1", batch_id: null, category: "legal", query: "질문입니다", created_at: "2026-09-26T19:00:00+09:00", results };
}

beforeEach(() => {
  app.providers = PROVIDERS;
  app.categories = [];
  router.route = { name: "detail", id: "q_1" };
  vi.spyOn(api, "providers").mockResolvedValue(PROVIDERS);
  vi.spyOn(api, "categories").mockResolvedValue([]);
  vi.spyOn(api, "stats").mockResolvedValue({ queries: 0, results: { pending: 0, processing: 0, done: 0, failed: 0 } });
  vi.spyOn(api, "extensionStatus").mockResolvedValue({ connected: false, clients: 0, providers: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("DeleteButton", () => {
  it("한 번 누르면 확인 상태가 되고 두 번째 누름에서만 삭제를 실행한다", async () => {
    const ondelete = vi.fn().mockResolvedValue(undefined);
    render(DeleteButton, { label: "결과 삭제", ondelete });
    const button = screen.getByRole("button", { name: "결과 삭제" });
    await fireEvent.click(button);
    expect(ondelete).not.toHaveBeenCalled();
    expect(screen.getByText("삭제 확인")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "결과 삭제 확인" }));
    await waitFor(() => expect(ondelete).toHaveBeenCalledOnce());
    expect(screen.queryByText("삭제 확인")).toBeNull();
  });

  it("3초 안에 다시 누르지 않으면 원래 상태로 돌아간다", async () => {
    vi.useFakeTimers();
    const ondelete = vi.fn().mockResolvedValue(undefined);
    render(DeleteButton, { label: "삭제", ondelete });
    await fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(screen.getByText("삭제 확인")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3100);
    expect(screen.queryByText("삭제 확인")).toBeNull();
    expect(ondelete).not.toHaveBeenCalled();
  });

  it("비활성일 때는 눌러도 확인 상태가 되지 않고 이유를 툴팁으로 알린다", async () => {
    render(DeleteButton, { label: "삭제", disabled: true, disabledReason: "처리 중에는 삭제할 수 없습니다", ondelete: vi.fn() });
    const button = screen.getByRole("button", { name: "삭제" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "처리 중에는 삭제할 수 없습니다");
  });
});

describe("DetailPanel", () => {
  it("패널 제목은 '답변'이고 답변 카드 제목은 provider 이름이다", async () => {
    vi.spyOn(api, "getQuery").mockResolvedValue(detail([result({ provider: "perplexity", result_id: "r_1" })]));
    render(DetailPanel, { id: "q_1" });
    expect(await screen.findByText("답변 perplexity")).toBeInTheDocument();
    expect(screen.getByText("답변", { selector: ".panel-title" })).toBeInTheDocument();
    expect(screen.queryByText("질의 상세")).toBeNull();
    expect(screen.getByText("legal")).toBeInTheDocument();
  });

  it("provider 결과 하나를 삭제하면(2단계 확인) 그 탭이 사라지고 다른 결과가 선택된다", async () => {
    vi.spyOn(api, "getQuery").mockResolvedValue(
      detail([result({ provider: "perplexity", result_id: "r_1" }), result({ provider: "claude", result_id: "r_2" })]),
    );
    const del = vi.spyOn(api, "deleteResult").mockResolvedValue({ query_deleted: false });
    render(DetailPanel, { id: "q_1" });
    await screen.findByText("답변 perplexity");

    await fireEvent.click(screen.getByRole("button", { name: "Perplexity 결과 삭제" }));
    expect(del).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Perplexity 결과 삭제 확인" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("q_1", "r_1"));

    expect(await screen.findByText("답변 claude")).toBeInTheDocument();
    expect(screen.queryByText("답변 perplexity")).toBeNull();
    expect(router.route).toEqual({ name: "detail", id: "q_1" }); // 질문은 남아 있으므로 이동하지 않는다
    expect(toast.message).toBe("Perplexity 결과를 삭제했습니다");
  });

  it("마지막 결과를 삭제해 질문이 사라지면 목록으로 돌아간다", async () => {
    vi.spyOn(api, "getQuery").mockResolvedValue(detail([result({ provider: "perplexity", result_id: "r_1" })]));
    vi.spyOn(api, "deleteResult").mockResolvedValue({ query_deleted: true });
    render(DetailPanel, { id: "q_1" });
    await screen.findByText("답변 perplexity");
    await fireEvent.click(screen.getByRole("button", { name: "Perplexity 결과 삭제" }));
    await fireEvent.click(screen.getByRole("button", { name: "Perplexity 결과 삭제 확인" }));
    await waitFor(() => expect(router.route).toEqual({ name: "home" }));
    expect(toast.message).toBe("질의를 삭제했습니다");
  });

  it("질의 삭제는 모든 provider 결과를 지우고 목록으로 돌아간다", async () => {
    vi.spyOn(api, "getQuery").mockResolvedValue(
      detail([result({ provider: "perplexity", result_id: "r_1" }), result({ provider: "claude", result_id: "r_2", status: "failed", answer: null, error_message: "boom" })]),
    );
    const del = vi.spyOn(api, "deleteQuery").mockResolvedValue(null);
    render(DetailPanel, { id: "q_1" });
    await screen.findByText("답변 perplexity");

    await fireEvent.click(screen.getByRole("button", { name: "질의 삭제" }));
    expect(del).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "질의 삭제 확인" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("q_1"));
    await waitFor(() => expect(router.route).toEqual({ name: "home" }));
  });

  it("처리 중인 결과가 있으면 삭제 버튼이 비활성이다", async () => {
    vi.spyOn(api, "getQuery").mockResolvedValue(
      detail([result({ provider: "perplexity", result_id: "r_1", status: "processing", answer: null, progress_message: "답변 대기 중" })]),
    );
    render(DetailPanel, { id: "q_1" });
    await screen.findByText("답변 대기 중");
    expect(screen.getByRole("button", { name: "질의 삭제" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Perplexity 결과 삭제" })).toBeDisabled();
  });

  it("서버가 삭제를 거절하면(409) 화면을 유지하고 오류를 알린다", async () => {
    vi.spyOn(api, "getQuery").mockResolvedValue(detail([result({ provider: "perplexity", result_id: "r_1" })]));
    vi.spyOn(api, "deleteQuery").mockRejectedValue(new Error("처리 중인 provider가 있어 삭제할 수 없습니다."));
    render(DetailPanel, { id: "q_1" });
    await screen.findByText("답변 perplexity");
    await fireEvent.click(screen.getByRole("button", { name: "질의 삭제" }));
    await fireEvent.click(screen.getByRole("button", { name: "질의 삭제 확인" }));
    await waitFor(() => expect(toast.message).toContain("처리 중인 provider"));
    expect(router.route).toEqual({ name: "detail", id: "q_1" });
    expect(screen.getByText("답변 perplexity")).toBeInTheDocument();
  });
});
