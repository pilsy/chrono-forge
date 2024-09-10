import { ChronoFlow, ChronoFlowOptions, Workflow } from './Workflow';

@ChronoFlow()
export class ChatTagProcessorWorkflow extends Workflow {
  protected name: string;
  protected content: string;

  constructor(args: any[], options: ChronoFlowOptions = {}) {
    super(args, options);
    const { name, content } = args[0];
    this.name = name;
    this.content = content;
  }

  protected async execute(): Promise<string> {
    if (this.name === 'outer') {
      return (
        ' ' +
        this.content
          .split(' ')
          .map((content) => 'X')
          .join(' ')
      );
    }
    return this.content.toUpperCase();
  }
}
