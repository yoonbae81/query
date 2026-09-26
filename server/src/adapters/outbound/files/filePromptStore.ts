import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isValidCategory } from "../../../domain/category";
import type { PromptInfo, PromptStorePort } from "../../../domain/ports";

const EXT = ".md";

/**
 * 카테고리별 시스템 프롬프트를 `<dir>/<category>.md` 파일로 관리한다.
 * 카테고리 이름은 도메인 규칙(글자·숫자·-·_)으로 검증되므로 경로 이탈이 불가능하다.
 */
export class FilePromptStore implements PromptStorePort {
  constructor(private readonly dir: string) {}

  private file(category: string): string {
    if (!isValidCategory(category)) throw new Error(`잘못된 카테고리 이름: ${category}`);
    return join(this.dir, `${category}${EXT}`);
  }

  async list(): Promise<PromptInfo[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const out: PromptInfo[] = [];
    for (const name of names) {
      if (!name.endsWith(EXT)) continue;
      const category = name.slice(0, -EXT.length);
      if (!isValidCategory(category)) continue; // 규칙에 맞지 않는 파일은 무시
      const [info, content] = await Promise.all([stat(join(this.dir, name)), readFile(join(this.dir, name), "utf8")]);
      out.push({ category, updatedAt: info.mtime, size: content.length });
    }
    return out.sort((a, b) => a.category.localeCompare(b.category));
  }

  async read(category: string): Promise<{ content: string; updatedAt: Date } | null> {
    const path = this.file(category);
    try {
      const [content, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
      return { content, updatedAt: info.mtime };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async write(category: string, content: string): Promise<Date> {
    const path = this.file(category);
    await mkdir(this.dir, { recursive: true });
    await writeFile(path, content, "utf8");
    return (await stat(path)).mtime;
  }

  async delete(category: string): Promise<boolean> {
    const path = this.file(category);
    try {
      await stat(path);
    } catch {
      return false;
    }
    await rm(path, { force: true });
    return true;
  }
}
