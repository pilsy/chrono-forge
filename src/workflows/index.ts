import { WorkflowInterceptorsFactory } from '@temporalio/workflow';
import { OpenTelemetryInboundInterceptor, OpenTelemetryOutboundInterceptor } from '@temporalio/interceptors-opentelemetry/lib/workflow';

export const interceptors: WorkflowInterceptorsFactory = () => ({
  inbound: [new OpenTelemetryInboundInterceptor()],
  outbound: [new OpenTelemetryOutboundInterceptor()]
});

export * from './Workflow';
export * from './StatefulWorkflow';
export * from './ChatTagProcessorWorkflow';
export * from '../utils/limitRecursion';
export * from '../decorators';
