/**
 * 답변 DOM을 마크다운으로 변환한다(웹 UI가 마크다운을 렌더링하므로 innerText보다 구조를 보존한다).
 * 헤딩, 문단, 목록(중첩), 굵게/기울임, 인라인 코드, 코드 블록, 링크, 인용, 표를 지원한다.
 */
export function htmlToMarkdown(root: Element): string {
  const out = blocks(root, 0);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

const HEADING = /^h([1-6])$/;

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const inner = () => [...el.childNodes].map(inline).join("");
  switch (tag) {
    case "strong":
    case "b":
      return wrap(inner(), "**");
    case "em":
    case "i":
      return wrap(inner(), "*");
    case "code":
      return `\`${el.textContent ?? ""}\``;
    case "br":
      return "  \n";
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const text = inner().trim();
      return href && text ? `[${text}](${href})` : text;
    }
    case "script":
    case "style":
    case "button":
    case "svg":
      return "";
    default:
      return inner();
  }
}

function wrap(text: string, mark: string): string {
  const t = text.trim();
  return t ? `${mark}${t}${mark}` : "";
}

function list(el: Element, depth: number): string {
  const ordered = el.tagName.toLowerCase() === "ol";
  let index = 1;
  const lines: string[] = [];
  for (const child of el.children) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const marker = ordered ? `${index++}.` : "-";
    const indent = "  ".repeat(depth);
    const text: string[] = [];
    const nested: string[] = [];
    for (const n of child.childNodes) {
      const tag = n.nodeType === Node.ELEMENT_NODE ? (n as Element).tagName.toLowerCase() : "";
      if (tag === "ul" || tag === "ol") nested.push(list(n as Element, depth + 1));
      else text.push(inline(n));
    }
    lines.push(`${indent}${marker} ${text.join("").trim()}`);
    lines.push(...nested);
  }
  return lines.join("\n");
}

function table(el: Element): string {
  const rows = [...el.querySelectorAll("tr")].map((tr) =>
    [...tr.children].map((c) => inline(c).trim().replace(/\|/g, "\\|")),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => `| ${[...r, ...Array<string>(width - r.length).fill("")].join(" | ")} |`;
  const [head, ...body] = rows;
  return [pad(head!), pad(Array<string>(width).fill("---")), ...body.map(pad)].join("\n");
}

function blocks(el: Element, depth: number): string {
  const parts: string[] = [];
  let pendingInline = "";
  const flush = () => {
    if (pendingInline.trim()) parts.push(pendingInline.trim());
    pendingInline = "";
  };
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      pendingInline += inline(node);
      continue;
    }
    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    const heading = HEADING.exec(tag);
    if (heading) {
      flush();
      parts.push(`${"#".repeat(Number(heading[1]))} ${inline(child).trim()}`);
    } else if (tag === "p") {
      flush();
      parts.push(inline(child).trim());
    } else if (tag === "ul" || tag === "ol") {
      flush();
      parts.push(list(child, depth));
    } else if (tag === "pre") {
      flush();
      const code = child.textContent?.replace(/\n$/, "") ?? "";
      const lang = /language-([\w-]+)/.exec(child.querySelector("code")?.className ?? "")?.[1] ?? "";
      parts.push("```" + lang + "\n" + code + "\n```");
    } else if (tag === "blockquote") {
      flush();
      parts.push(
        blocks(child, depth)
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n"),
      );
    } else if (tag === "table") {
      flush();
      parts.push(table(child));
    } else if (tag === "hr") {
      flush();
      parts.push("---");
    } else if (tag === "div" || tag === "section" || tag === "article" || tag === "span") {
      if (child.querySelector("p,ul,ol,pre,table,blockquote,h1,h2,h3,h4,h5,h6")) {
        flush();
        parts.push(blocks(child, depth));
      } else {
        pendingInline += inline(child);
      }
    } else {
      pendingInline += inline(child);
    }
  }
  flush();
  return parts.filter((p) => p !== "").join("\n\n");
}
