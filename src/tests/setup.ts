import path from 'path';
import { WorkflowCoverage } from '@temporalio/nyc-test-coverage';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger, LogEntry } from '@temporalio/worker';
import { Client, WorkflowClient } from '@temporalio/client';
import { v4 as uuid4 } from 'uuid';
import {
  makeWorkflowExporter,
  OpenTelemetryActivityInboundInterceptor
} from '@temporalio/interceptors-opentelemetry/lib/worker';
import { getExporter, getResource, initTracer, getTracer } from '../utils/instrumentation';
import { Tracer } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { logger } from '../utils/logger';

jest.setTimeout(60000);

declare global {
  var tracer: Tracer | undefined;
  var exporter: OTLPTraceExporter | undefined;
  var resource: Resource | undefined;
  var testEnv: TestWorkflowEnvironment;
  var worker: Worker;
  var client: Client;
  var nativeConnection: any;
  var shutdown: () => Promise<void>;
  var getClient: () => Client;
  var execute: (workflowName: string, params: any, timeout: number) => () => any;
  var workflowCoverage: WorkflowCoverage;
  var sleep: (duration?: number) => Promise<void>;
  var mockActivities: { [key: string]: (...args: any[]) => Promise<any> };
}

global.tracer = initTracer('temporal_worker', 'local', 'http://localhost:4317/v1/traces')?.tracer;
global.exporter = getExporter('temporal_worker');
global.resource = getResource('temporal_worker');

// @ts-ignore
logger.trace = (...args) => logger.verbose(...args);

Runtime.install({
  telemetryOptions: {
    // metrics: { otel: { url: 'http://localhost:4317/v1/metrics' } },
    // logging: {}
  },
  // @ts-ignore
  logger
});

global.sleep = async (duration = 1000) =>
  new Promise((resolve) => {
    setTimeout(async () => {
      resolve();
    }, duration);
  });

global.workflowCoverage = new WorkflowCoverage();

export const setup = async () => {
  global.testEnv = await TestWorkflowEnvironment.createLocal();
  const { client: workflowClient, nativeConnection: nc } = global.testEnv;
  global.client = workflowClient;
  global.nativeConnection = nc;
  global.getClient = () => testEnv.client;

  global.worker = await Worker.create(
    global.workflowCoverage!.augmentWorkerOptions({
      connection: global.nativeConnection,
      taskQueue: 'test',
      activities: {
        makeHTTPRequest: async () => '99'
      },
      workflowsPath: path.resolve(__dirname, './testWorkflows'),
      // debugMode: true,
      sinks: {
        // @ts-ignore
        exporter: makeWorkflowExporter(exporter, resource)
      },
      interceptors: {
        workflowModules: [require.resolve('./testWorkflows'), require.resolve('../workflows')],
        activityInbound: [(ctx) => new OpenTelemetryActivityInboundInterceptor(ctx)]
      },
      workflowThreadPoolSize: 2
    })
  );

  const runPromise = global.worker.run();
  global.shutdown = async () => {
    global.worker.shutdown();
    await runPromise;
    await global.testEnv.teardown();
    await Runtime._instance?.shutdown();
  };
};
