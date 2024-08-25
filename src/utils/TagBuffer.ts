import { uuid4 } from "@temporalio/workflow";

export class TagBuffer {
  public name: string;
  public content: string;
  public runId: string;
  private resolve: (processedContent: string) => void;

  constructor(name: string, content: string = '', resolve?: (processedContent: string) => void) {
    this.runId = uuid4();
    this.name = name;
    this.content = content;
    this.resolve = resolve || (() => {});
  }

  // Append content to the buffer
  public appendContent(data: string): void {
    this.content += data;
  }

  // Resolve the promise with the processed content
  public completeProcessing(processedContent: string): void {
    this.resolve(processedContent);
  }

  // Set the resolve function for processing completion
  public setResolveFunction(resolve: (processedContent: string) => void): void {
    this.resolve = resolve;
  }

  public json() {
    return {
      runId: this.runId,
      name: this.name,
      content: this.content
    }
  }
}