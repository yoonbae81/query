import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { toast } from "../lib/toast.svelte";
import type { ProviderInfo } from "../lib/types";
import MarkdownView, { renderMarkdown } from "./MarkdownView.svelte";
import QueryForm from "./QueryForm.svelte";

const PROVIDERS: ProviderInfo[] = [
  { id: "perplexity", name: "Perplexity", available: true, online: true },
  { id: "claude", name: "Claude", available: false, online: false },
];

afterEach(() => vi.restoreAllMocks());

describe("QueryForm", () => {
  it("Perplexity가 기본 체크되고 미지원 provider는 비활성이다", async () => {
    render(QueryForm, { providers: PROVIDERS, onsubmitted: () => {} });
    const perplexity = (await screen.findByLabelText("Perplexity")) as HTMLInputElement;
    const claude = screen.getByLabelText(/Claude/) as HTMLInputElement;
    expect(perplexity.checked).toBe(true);
    expect(claude.disabled).toBe(true);
    expect(screen.getByText(/준비 중/)).toBeInTheDocument();
  });

  it("요청 응답 전에는 제출 버튼이 비활성이고, 성공하면 목록 갱신을 알린다", async () => {
    let resolve!: () => void;
    const spy = vi.spyOn(api, "submit").mockReturnValue(new Promise((r) => (resolve = () => r({ query_id: "q_1" }))));
    const onsubmitted = vi.fn();
    render(QueryForm, { providers: PROVIDERS, onsubmitted });

    await fireEvent.input(screen.getByLabelText("질문"), { target: { value: "hello" } });
    const button = screen.getByRole("button", { name: /질의하기/ });
    await fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await fireEvent.click(button); // 연타해도 한 번만 전송
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("hello", ["perplexity"]);

    resolve();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(onsubmitted).toHaveBeenCalledOnce();
    expect(toast.message).toBe("질의가 접수되었습니다(1건 × 1 provider)");
  });

  it("벌크 입력은 줄 단위로 분리해 일괄 등록한다", async () => {
    const spy = vi.spyOn(api, "submitBulk").mockResolvedValue({ items: [{}, {}] });
    render(QueryForm, { providers: PROVIDERS, onsubmitted: () => {} });
    await fireEvent.click(screen.getByRole("tab", { name: "벌크 입력" }));
    await fireEvent.input(screen.getByLabelText("질문"), { target: { value: "a\n\n b \nc" } });
    await fireEvent.click(screen.getByRole("button", { name: /일괄 질의하기/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(["a", "b", "c"], ["perplexity"]));
  });

  it("빈 질문은 전송하지 않는다", async () => {
    const spy = vi.spyOn(api, "submit");
    render(QueryForm, { providers: PROVIDERS, onsubmitted: () => {} });
    await fireEvent.click(screen.getByRole("button", { name: /질의하기/ }));
    expect(spy).not.toHaveBeenCalled();
    expect(toast.message).toBe("질문을 입력하세요");
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
