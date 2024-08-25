/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
  Signal,
  Query,
  Workflow,
  WorkflowClass,
  Hook
} from './Chronicle';

// import { ChatTagProcessorWorkflow } from "./ChatTagProcessorWorkflow";

@Workflow('ExampleTagProcessorWorkflow')
export class ExampleTagProcessorWorkflow extends WorkflowClass {
  protected name: string;
  protected content: string;

  // @ts-ignore
  constructor({name, content}) {
    super(name, content);
    this.name = name;
    this.content = content;
  }

  @Query("content")
  async getContent() {
    return this.content;
  }

  @Signal()
  async setContent(content: string) {
    this.content = content;
  }

  @Hook({ before: "execute" })
  async beforeExecuteHook() {
    this.log.info(`Before processing ${this.name} tag with content: ${this.content}`);
    this.start = Date.now();
  }

  protected execute(): Promise<string> {
    const processedContent = this.content.toUpperCase(); // Example processing
    return processedContent;
  }

  @Hook({ after: "execute" })
  async afterExecuteHook() {
    this.log.info(`After processing ${this.name} tag with content: ${this.content}`);
    this.end = Date.now();
    this.totalTime = this.end - this.start;
    this.log.info(`Took ${this.totalTime}`);
  }
}
