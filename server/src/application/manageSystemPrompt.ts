import type { SystemPromptConfigPort } from "../domain/ports";

export class ManageSystemPrompt {
  constructor(private readonly prompt: SystemPromptConfigPort) {}

  get(): Promise<{ content: string; updatedAt: Date }> {
    return this.prompt.read();
  }

  async update(content: string): Promise<{ content: string; updatedAt: Date }> {
    return { content, updatedAt: await this.prompt.write(content) };
  }
}
