import { Workflow, ChronoFlow } from '../../workflows';
import { Property, Set } from '../../decorators';

@ChronoFlow()
export class ShouldInvokeSetMethodOnPropertySet extends Workflow {
  @Property()
  protected value: string = '';

  @Set('value')
  protected setValue(newValue: string) {
    this.value = newValue;
  }

  async execute() {
    return this.value;
  }
}
