import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { SystemPromptConfigPort } from "../../../domain/ports";

export class FileSystemPrompt implements SystemPromptConfigPort {
  constructor(private readonly path: string) {}

  async read(): Promise<{ content: string; updatedAt: Date }> {
    try {
      const [content, info] = await Promise.all([readFile(this.path, "utf8"), stat(this.path)]);
      return { content, updatedAt: info.mtime };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { content: "", updatedAt: new Date() };
      throw e;
    }
  }

  async write(content: string): Promise<Date> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, content, "utf8");
    return (await this.read()).updatedAt;
  }
}
