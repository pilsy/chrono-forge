import { Workflow, ChronoFlow } from '../../workflows';
import { Property, Get } from '../../decorators';

@ChronoFlow()
export class ShouldInvokeGetMethodOnPropertyGet extends Workflow {
  private _value: string = 'Processed by @Get decorator';

  @Property({ get: 'queryValue' })
  public get value() {
    return this._value;
  }

  @Get('queryValue')
  public getValue() {
    return this._value;
  }

  async execute() {
    return this.value;
  }
}
