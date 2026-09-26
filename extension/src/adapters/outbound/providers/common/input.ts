/**
 * 입력창에 텍스트를 넣는다. 사이트의 에디터(React/Lexical 등)가 값을 인식하도록 이벤트를 함께 발생시킨다.
 * 실제 사이트에서의 동작은 스파이크로 검증해야 한다.
 */
export function insertText(el: HTMLElement, text: string): void {
  el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  // contenteditable: 기존 내용을 선택한 뒤 insertText 명령으로 대체
  const doc = el.ownerDocument;
  doc.getSelection()?.selectAllChildren(el);
  const inserted = typeof doc.execCommand === "function" && doc.execCommand("insertText", false, text);
  if (inserted && (el.textContent ?? "").includes(text.slice(0, 20))) return;

  // 폴백: 붙여넣기 이벤트 (에디터가 paste를 처리하는 경우)
  const data = new DataTransfer();
  data.setData("text/plain", text);
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
}

export function pressEnter(el: HTMLElement): void {
  const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keypress", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
}
