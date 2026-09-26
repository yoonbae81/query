import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { router } from "../lib/router.svelte";
import { app } from "../lib/stores.svelte";
import { applyTheme, getStoredThemeMode, nextThemeMode, setStoredThemeMode } from "../lib/theme";
import { toast } from "../lib/toast.svelte";
import type { CategoryInfo, ProviderInfo, QuerySummary } from "../lib/types";
import BulkModal from "./BulkModal.svelte";
import Header from "./Header.svelte";
import MarkdownView, { renderMarkdown } from "./MarkdownView.svelte";
import PromptsModal from "./PromptsModal.svelte";
import QueryBar from "./QueryBar.svelte";
import QueryListPanel from "./QueryListPanel.svelte";

const PROVIDERS: ProviderInfo[] = [
  { id: "perplexity", name: "Perplexity", available: true, online: true },
  { id: "claude", name: "Claude", available: false, online: false },
];
const CATEGORIES: CategoryInfo[] = [
  { category: "general", has_prompt: true, prompt_size: 3, query_count: 2 },
  { category: "legal", has_prompt: true, prompt_size: 5, query_count: 1 },
  { category: "tech", has_prompt: false, prompt_size: 0, query_count: 1 },
];

function item(over: Partial<QuerySummary> = {}): QuerySummary {
  return {
    query_id: "q_1",
    batch_id: null,
    category: "general",
    query: "원자력 인허가 절차",
    created_at: "2026-09-26T19:00:00+09:00",
    answer_preview: null,
    results_summary: [{ provider: "perplexity", status: "done" }],
    ...over,
  };
}

beforeEach(() => {
  app.providers = PROVIDERS;
  app.categories = CATEGORIES;
  app.stats = { queries: 4, results: { pending: 1, processing: 1, done: 2, failed: 0 } };
  app.extension = { connected: true, clients: 1, providers: [{ id: "perplexity", name: "Perplexity", online: true, states: ["ready"] }] };
  app.categoryFilter = null;
  vi.spyOn(api, "providers").mockResolvedValue(PROVIDERS);
  vi.spyOn(api, "categories").mockResolvedValue(CATEGORIES);
  vi.spyOn(api, "stats").mockResolvedValue(app.stats);
  vi.spyOn(api, "extensionStatus").mockResolvedValue(app.extension);
  router.route = { name: "home" };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("QueryBar", () => {
  it("Perplexity가 기본 선택이고 미지원 provider는 비활성이다", async () => {
    render(QueryBar);
    const perplexity = await screen.findByRole("button", { name: /Perplexity/ });
    expect(perplexity).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Claude/ })).toBeDisabled();
    expect(screen.getByText(/준비 중/)).toBeInTheDocument();
    expect((screen.getByLabelText("카테고리") as HTMLSelectElement).value).toBe("general");
  });

  it("질문과 카테고리를 보내고, 응답 전에는 다시 제출되지 않으며, 성공하면 상세로 이동한다", async () => {
    let resolve!: (v: { query_id: string }) => void;
    const submit = vi.spyOn(api, "submit").mockReturnValue(new Promise((r) => (resolve = r)));
    render(QueryBar);

    await fireEvent.input(screen.getByLabelText("질문"), { target: { value: "hello" } });
    await fireEvent.change(screen.getByLabelText("카테고리"), { target: { value: "legal" } });
    const button = screen.getByRole("button", { name: /질의하기/ });
    await fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await fireEvent.click(button); // 연타해도 한 번만 전송
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("hello", ["perplexity"], "legal");

    resolve({ query_id: "q_new" });
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(router.route).toEqual({ name: "detail", id: "q_new" });
    expect(toast.message).toBe("질의가 접수되었습니다(1건 × 1 provider)");
    expect((screen.getByLabelText("질문") as HTMLTextAreaElement).value).toBe("");
  });

  it("Enter로 제출하고 Shift+Enter는 줄바꿈이며 빈 질문은 보내지 않는다", async () => {
    const submit = vi.spyOn(api, "submit").mockResolvedValue({ query_id: "q_2" });
    render(QueryBar);
    const input = screen.getByLabelText("질문");
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    expect(toast.message).toBe("질문을 입력하세요");

    await fireEvent.input(input, { target: { value: "q" } });
    await fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(submit).not.toHaveBeenCalled();
    await fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  });

  it("카테고리 드롭다운은 질문 입력칸 앞에 있고 모든 카테고리를 항상 보여준다(입력값으로 걸러지지 않는다)", () => {
    render(QueryBar);
    const select = screen.getByLabelText("카테고리") as HTMLSelectElement;
    const question = screen.getByLabelText("질문");
    expect(select.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // 카테고리 → 질문 순서
    expect(select.value).toBe("general");
    expect([...select.options].map((o) => o.value)).toEqual(["general", "legal", "tech"]);
  });

  it("헤더에서 카테고리를 고르면 입력 카테고리가 따라간다", async () => {
    render(QueryBar);
    app.categoryFilter = "legal";
    await waitFor(() => expect((screen.getByLabelText("카테고리") as HTMLSelectElement).value).toBe("legal"));
  });
});

describe("BulkModal", () => {
  it("줄 단위로 분리해 카테고리와 함께 일괄 등록한다", async () => {
    const bulk = vi.spyOn(api, "submitBulk").mockResolvedValue({ items: [{ query_id: "a" }, { query_id: "b" }, { query_id: "c" }] });
    const onclose = vi.fn();
    render(BulkModal, { onclose });
    await fireEvent.input(screen.getByLabelText("질문 목록"), { target: { value: "a\n\n b \nc" } });
    await fireEvent.change(screen.getByLabelText("카테고리"), { target: { value: "tech" } });
    expect(screen.getByText("3건")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /일괄 질의하기/ }));
    await waitFor(() => expect(bulk).toHaveBeenCalledWith(["a", "b", "c"], ["perplexity"], "tech"));
    expect(onclose).toHaveBeenCalled();
    expect(toast.message).toContain("3건");
  });

  it("Esc로 닫힌다", async () => {
    const onclose = vi.fn();
    render(BulkModal, { onclose });
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onclose).toHaveBeenCalled();
  });
});

describe("PromptsModal", () => {
  function mockPrompts() {
    vi.spyOn(api, "getPrompt").mockImplementation(async (c) => ({ category: c, content: c === "general" ? "GENERAL" : "", updated_at: "" }));
    return {
      save: vi.spyOn(api, "savePrompt").mockImplementation(async (c, content) => ({ category: c, content, updated_at: "" })),
      del: vi.spyOn(api, "deletePrompt").mockResolvedValue(null),
    };
  }

  it("general 답변작성 지침를 불러오고 카테고리 목록을 보여준다", async () => {
    mockPrompts();
    render(PromptsModal, { onclose: () => {} });
    expect(await screen.findByDisplayValue("GENERAL")).toBeInTheDocument();
    for (const name of ["general", "legal", "tech"]) expect(screen.getByRole("button", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    expect(screen.getByText("general 적용")).toBeInTheDocument(); // tech는 답변작성 지침가 없어 general이 적용된다
  });

  it("새 카테고리를 만들어 답변작성 지침를 저장한다", async () => {
    const { save } = mockPrompts();
    render(PromptsModal, { onclose: () => {} });
    await screen.findByDisplayValue("GENERAL");

    await fireEvent.input(screen.getByLabelText("새 카테고리"), { target: { value: "Nuclear-Safety" } });
    await fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
    const editor = await screen.findByLabelText("nuclear-safety 답변작성 지침");
    await fireEvent.input(editor, { target: { value: "원전 안전 관점" } });
    await fireEvent.click(screen.getByRole("button", { name: /저장/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("nuclear-safety", "원전 안전 관점"));
  });

  it("잘못된 카테고리 이름은 서버에 보내기 전에 거절한다", async () => {
    mockPrompts();
    render(PromptsModal, { onclose: () => {} });
    await screen.findByDisplayValue("GENERAL");
    await fireEvent.input(screen.getByLabelText("새 카테고리"), { target: { value: "../evil" } });
    await fireEvent.click(screen.getByRole("button", { name: "카테고리 추가" }));
    expect(toast.message).toContain("카테고리는");
    expect(screen.queryByLabelText(/evil/)).toBeNull();
  });

  it("삭제는 두 번 눌러야 하고 general은 삭제 버튼이 없다", async () => {
    const { del } = mockPrompts();
    render(PromptsModal, { onclose: () => {} });
    await screen.findByDisplayValue("GENERAL");
    expect(screen.queryByRole("button", { name: /삭제/ })).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: /^legal/ }));
    const button = await screen.findByRole("button", { name: "삭제" });
    await fireEvent.click(button);
    expect(del).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("legal"));
  });

  it("저장하지 않은 변경이 있으면 다른 카테고리로 옮기기 전에 확인한다", async () => {
    mockPrompts();
    const confirmFn = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmFn);
    render(PromptsModal, { onclose: () => {} });
    const editor = await screen.findByDisplayValue("GENERAL");
    await fireEvent.input(editor, { target: { value: "수정" } });
    expect(screen.getByText("수정됨")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /^legal/ }));
    expect(confirmFn).toHaveBeenCalled();
    expect(screen.getByDisplayValue("수정")).toBeInTheDocument(); // 취소했으니 그대로
  });
});

describe("QueryListPanel", () => {
  it("질의를 카드로 보여주고 답변 미리보기·카테고리를 표시하며 클릭하면 상세로 이동한다", async () => {
    vi.spyOn(api, "listQueries").mockResolvedValue({
      items: [item({ answer_preview: "인허가는 부지승인, 건설허가…", category: "legal" }), item({ query_id: "q_2", query: "두 번째", results_summary: [{ provider: "perplexity", status: "processing" }] })],
      next_cursor: null,
    });
    render(QueryListPanel);
    expect(await screen.findByText("원자력 인허가 절차")).toBeInTheDocument();
    expect(screen.getByText("인허가는 부지승인, 건설허가…")).toBeInTheDocument();
    expect(screen.getByText("legal")).toBeInTheDocument();

    await fireEvent.click(screen.getByText("두 번째"));
    expect(router.route).toEqual({ name: "detail", id: "q_2" });
  });

  it("카테고리 필터·상태·검색어를 서버에 전달한다", async () => {
    const list = vi.spyOn(api, "listQueries").mockResolvedValue({ items: [], next_cursor: null });
    render(QueryListPanel);
    await screen.findByText("등록된 질의가 없습니다");
    expect(list).toHaveBeenLastCalledWith({ limit: 20, category: null, search: "", status: "" });

    app.categoryFilter = "legal";
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ category: "legal" })));

    await fireEvent.change(screen.getByLabelText("상태 필터"), { target: { value: "done" } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "done" })));

    await fireEvent.input(screen.getByLabelText("질문 검색"), { target: { value: "변전소" } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "변전소" })), { timeout: 1500 });
  });

  it("좌측 패널 제목은 '질의'이다", async () => {
    vi.spyOn(api, "listQueries").mockResolvedValue({ items: [], next_cursor: null });
    render(QueryListPanel);
    expect(screen.getByText("질의", { selector: ".panel-title" })).toBeInTheDocument();
    expect(screen.queryByText("질의 내역")).toBeNull();
  });

  it("각 질의의 삭제 버튼은 두 번 눌러야 삭제되고, 보고 있던 질의를 지우면 목록으로 돌아간다", async () => {
    const list = vi.spyOn(api, "listQueries").mockResolvedValue({ items: [item({ query_id: "q_1" }), item({ query_id: "q_2", query: "두 번째" })], next_cursor: null });
    const del = vi.spyOn(api, "deleteQuery").mockResolvedValue(null);
    router.route = { name: "detail", id: "q_2" };
    render(QueryListPanel);
    await screen.findByText("두 번째");

    const buttons = screen.getAllByRole("button", { name: "질의 삭제" });
    expect(buttons).toHaveLength(2);
    await fireEvent.click(buttons[1]!);
    expect(del).not.toHaveBeenCalled();
    list.mockResolvedValue({ items: [item({ query_id: "q_1" })], next_cursor: null });
    await fireEvent.click(screen.getByRole("button", { name: "질의 삭제 확인" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("q_2"));
    await waitFor(() => expect(screen.queryByText("두 번째")).toBeNull());
    expect(router.route).toEqual({ name: "home" }); // 보고 있던 질의였으므로 목록으로
  });

  it("처리 중인 provider가 있는 질의는 삭제 버튼이 비활성이다", async () => {
    vi.spyOn(api, "listQueries").mockResolvedValue({ items: [item({ results_summary: [{ provider: "perplexity", status: "processing" }] })], next_cursor: null });
    render(QueryListPanel);
    await screen.findByText("원자력 인허가 절차");
    expect(screen.getByRole("button", { name: "질의 삭제" })).toBeDisabled();
  });

  it("더 보기로 다음 페이지를 이어 붙인다", async () => {
    const list = vi
      .spyOn(api, "listQueries")
      .mockResolvedValueOnce({ items: [item()], next_cursor: "CUR" })
      .mockResolvedValueOnce({ items: [item({ query_id: "q_9", query: "다음 페이지" })], next_cursor: null });
    render(QueryListPanel);
    await screen.findByText("원자력 인허가 절차");
    await fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(await screen.findByText("다음 페이지")).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "CUR" }));
    expect(screen.queryByRole("button", { name: "더 보기" })).toBeNull();
  });
});

describe("Header", () => {
  it("집계와 확장 상태를 보여주고 헤더에는 카테고리 내비가 없다", () => {
    render(Header, { onbulk: () => {}, onprompts: () => {} });
    expect(screen.getByText("Queue: 2")).toBeInTheDocument();
    expect(screen.getByText("답변: 2")).toBeInTheDocument();
    expect(screen.getByText("확장 연결됨")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "카테고리" })).toBeNull();
    expect(screen.queryByRole("button", { name: "legal" })).toBeNull();
  });

  it("확장이 없으면 끊김으로 표시한다", () => {
    app.extension = { connected: false, clients: 0, providers: [] };
    render(Header, { onbulk: () => {}, onprompts: () => {} });
    expect(screen.getByText("확장 끊김")).toBeInTheDocument();
  });

  it("테마 버튼은 auto → light → dark 순으로 돌고 저장된다", async () => {
    render(Header, { onbulk: () => {}, onprompts: () => {} });
    const button = () => screen.getByRole("button", { name: /테마 변경/ });
    await fireEvent.click(button());
    expect(localStorage.getItem("query_theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    await fireEvent.click(button());
    expect(localStorage.getItem("query_theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("theme", () => {
  it("순환 순서와 저장/기본값", () => {
    expect(["auto", "light", "dark"].map((m) => nextThemeMode(m as never))).toEqual(["light", "dark", "auto"]);
    expect(getStoredThemeMode()).toBe("auto");
    setStoredThemeMode("light");
    expect(getStoredThemeMode()).toBe("light");
    localStorage.setItem("query_theme", "garbage");
    expect(getStoredThemeMode()).toBe("auto");
  });

  it("auto는 시스템 설정을 따른다", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("light"), addEventListener() {}, removeEventListener() {} }));
    applyTheme("auto");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("MarkdownView", () => {
  it("스크립트와 이벤트 핸들러를 제거하고 링크는 새 탭으로 연다", () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror="alert(2)">\n\n[링크](https://example.com)');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("마크다운을 렌더링한다", () => {
    render(MarkdownView, { text: "## 제목\n\n- 항목" });
    expect(screen.getByRole("heading", { name: "제목" })).toBeInTheDocument();
    expect(screen.getByText("항목")).toBeInTheDocument();
  });
});
