import { WorkflowInterceptorsFactory } from '@temporalio/workflow';
import { OpenTelemetryInboundInterceptor, OpenTelemetryOutboundInterceptor } from '@temporalio/interceptors-opentelemetry/lib/workflow';

export const interceptors: WorkflowInterceptorsFactory = () => ({
  inbound: [new OpenTelemetryInboundInterceptor()],
  outbound: [new OpenTelemetryOutboundInterceptor()]
});

export { ShouldBindSignalsCorrectly } from './ShouldBindSignalsCorrectly';
export { ShouldBindNamedSignalsCorrectly } from './ShouldBindNamedSignalsCorrectly';
export { ShouldEmitEventOnSignal } from './ShouldEmitEventOnSignal';
export { ShouldExecuteWithArguments } from './ShouldExecuteWithArguments';
export { ShouldBindQueriesCorrectly } from './ShouldBindQueriesCorrectly';
export { ShouldApplyBeforeHooksCorrectly } from './ShouldApplyBeforeHooksCorrectly';
export { ShouldApplyAfterHooksCorrectly } from './ShouldApplyAfterHooksCorrectly';
export { ShouldExecuteStateful } from './ShouldExecuteStateful';
export { ShouldCreateDefaultPropertyAccessors } from './ShouldCreateDefaultPropertyAccessors';
export { ShouldCreateCustomPropertyAccessors } from './ShouldCreateCustomPropertyAccessors';
export { ShouldDisableSetForProperty } from './ShouldDisableSetForProperty';
export { ShouldInvokeSetMethodOnPropertySet } from './ShouldInvokeSetMethodOnPropertySet';
export { ShouldInvokeGetMethodOnPropertyGet } from './ShouldInvokeGetMethodOnPropertyGet';
export { ShouldExecuteStatefulChild } from './ShouldExecuteStatefulChild';
