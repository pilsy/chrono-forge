import { WorkflowInterceptorsFactory } from '@temporalio/workflow';
import { OpenTelemetryInboundInterceptor, OpenTelemetryOutboundInterceptor } from '@temporalio/interceptors-opentelemetry/lib/workflow';

export const interceptors: WorkflowInterceptorsFactory = () => ({
  inbound: [new OpenTelemetryInboundInterceptor()],
  outbound: [new OpenTelemetryOutboundInterceptor()]
});

import { StatefulWorkflow } from './StatefulWorkflow';
export { Workflow } from './Workflow';