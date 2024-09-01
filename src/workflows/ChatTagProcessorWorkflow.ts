import { ChronoFlow, Workflow } from './Workflow';

@ChronoFlow()
export abstract class ChatTagProcessor extends Workflow {
  protected name: string;
  protected content: string;

  constructor({ name, content }: { name: string; content: string }) {
    super();
    this.name = name;
    this.content = content;
  }

  // The main execution flow for a tag processor
  protected async execute(): Promise<string> {
    return await this.processTag(this.name, this.content);
  }

  // Abstract method to be implemented by specific tag processors
  protected abstract processTag(name: string, content: string): Promise<string>;
}
