<script module lang="ts">
  import DOMPurify from "dompurify";
  import { marked } from "marked";

  // 답변 속 링크는 항상 새 탭에서 안전하게 연다
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });

  export function renderMarkdown(text: string): string {
    return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  }
</script>

<script lang="ts">
  let { text }: { text: string } = $props();
  const html = $derived(renderMarkdown(text));
</script>

<div class="answer">{@html html}</div>
