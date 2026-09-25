import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { ProviderAnswer } from "../../../domain/entities";
import type { AnswerFileStoragePort } from "../../../domain/ports";
import { formatIso, formatYyMMdd } from "../../../util/time";

/** `yyMMdd_{query_id}_{provider}.md` 저장 (PLAN §6.7). 날짜와 시각은 표시 시간대(KST) 기준. */
export class FileAnswerStorage implements AnswerFileStoragePort {
  constructor(
    private readonly answersDir: string,
    private readonly timeZone: string,
  ) {}

  async save(p: {
    queryId: string;
    provider: string;
    systemPrompt: string;
    question: string;
    answer: ProviderAnswer;
    createdAt: Date;
    answeredAt: Date;
  }): Promise<string> {
    const name = `${formatYyMMdd(p.answeredAt, this.timeZone)}_${p.queryId}_${p.provider}.md`;
    const citations = p.answer.citations.map((c) => `- ${c}`).join("\n");
    const content =
      `# ${p.queryId} — ${p.provider}\n\n` +
      `## System Prompt\n${p.systemPrompt}\n\n` +
      `## Question\n${p.question}\n\n` +
      `## Answer\n${p.answer.text}\n\n` +
      `## Citations\n${citations}\n\n` +
      `---\n` +
      `provider: ${p.provider}\n` +
      `created_at: ${formatIso(p.createdAt, this.timeZone)}\n` +
      `answered_at: ${formatIso(p.answeredAt, this.timeZone)}\n`;
    await mkdir(this.answersDir, { recursive: true });
    await writeFile(join(this.answersDir, name), content, "utf8");
    return `${basename(this.answersDir)}/${name}`;
  }

  async delete(path: string): Promise<void> {
    await rm(join(dirname(this.answersDir), path), { force: true });
  }
}
