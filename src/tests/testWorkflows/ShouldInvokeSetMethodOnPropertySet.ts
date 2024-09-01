import { Workflow, ChronoFlow, Property, Set } from '../../workflows/Workflow';

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
