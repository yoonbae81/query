import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

import type { ProviderAnswer } from "../../../domain/entities";
import type { AnswerFileStoragePort } from "../../../domain/ports";
import { formatIso, formatYyMMdd } from "../../../util/time";

/**
 * `yyMMdd_{query_id}_{provider}.md` 저장. query_id의 `q_` 접두사는 파일명에서 뺀다
 * (예: 260926_6m1vl6_perplexity.md). 날짜와 시각은 표시 시간대(KST) 기준.
 */
export class FileAnswerStorage implements AnswerFileStoragePort {
  private readonly dir: string;

  constructor(
    answersDir: string,
    private readonly timeZone: string,
  ) {
    this.dir = resolve(answersDir);
  }

  private iso(dt: Date): string {
    return formatIso(dt, this.timeZone);
  }

  /** DB에 저장된 상대 경로(answers/…)를 실제 경로로 바꾼다. 답변 디렉터리 밖이면 null */
  private resolveInside(path: string): string | null {
    const full = resolve(dirname(this.dir), path);
    return full.startsWith(this.dir + sep) ? full : null;
  }

  async save(p: {
    queryId: string;
    provider: string;
    category: string;
    systemPrompt: string;
    question: string;
    answer: ProviderAnswer;
    createdAt: Date;
    answeredAt: Date;
  }): Promise<string> {
    const id = p.queryId.replace(/^q_/, "");
    const name = `${formatYyMMdd(p.answeredAt, this.timeZone)}_${id}_${p.provider}.md`;
    const citations = p.answer.citations.map((c) => `- ${c}`).join("\n");
    const content =
      `# ${p.queryId} — ${p.provider}\n\n` +
      `## Question\n${p.question}\n\n` +
      `## 답변작성 지침\n${p.systemPrompt}\n\n` +
      `## Answer\n${p.answer.text}\n\n` +
      `## Citations\n${citations}\n\n` +
      `---\n` +
      `provider: ${p.provider}\n` +
      `category: ${p.category}\n` +
      `created_at: ${this.iso(p.createdAt)}\n` +
      `answered_at: ${this.iso(p.answeredAt)}\n`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, name), content, "utf8");
    return `${basename(this.dir)}/${name}`;
  }

  async read(path: string): Promise<string | null> {
    const full = this.resolveInside(path);
    if (!full) return null;
    try {
      return await readFile(full, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(path: string): Promise<void> {
    const full = this.resolveInside(path);
    if (full) await rm(full, { force: true });
  }
}
