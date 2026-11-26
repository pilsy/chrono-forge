import path from 'path';
import { WorkflowCoverage } from '@temporalio/nyc-test-coverage';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker, Runtime, DefaultLogger, LogEntry, makeTelemetryFilterString } from '@temporalio/worker';
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
  var mergeWorkflowCoverage: () => void;
  var sleep: (duration?: number) => Promise<void>;
  var activities: { [key: string]: (...args: any[]) => Promise<any> };
}

/**
 * Merge the coverage collected inside the workflow sandbox into Jest's global coverage, then unwrap any entry that
 * arrives as `{ data: … }`. Jest's coverage reporter rejects wrapped entries ("Invalid file coverage object, missing
 * keys, found:data"); in a parallel run that silently dropped whole suites from the report while `npm test` still
 * exited 0, and in a serial run it failed later suites in the same process.
 */
export const normalizeCoverage = () => {
  const coverage = (globalThis as any).__coverage__ as Record<string, any> | undefined;
  for (const [file, original] of Object.entries(coverage ?? {})) {
    let entry = original;
    while (entry && !entry.statementMap && (entry.data || typeof entry.toJSON === 'function')) {
      const next = typeof entry.toJSON === 'function' ? entry.toJSON() : entry.data;
      if (next === entry) break;
      entry = next;
    }
    coverage![file] = entry;
  }
};

global.mergeWorkflowCoverage = () => {
  global.workflowCoverage.mergeIntoGlobalCoverage();
  normalizeCoverage();
};

global.activities = {
  // @ts-ignore
  waitForDuration: jest.fn().mockImplementation(async (duration) => {
    const ms = parseInt(duration, 10);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return 'waitResult';
  }),
  // @ts-ignore
  makeHTTPRequest: jest.fn().mockResolvedValue('httpResult'), // @ts-ignore
  formatData: jest.fn().mockResolvedValue('formattedData'), // @ts-ignore
  processResult: jest.fn().mockResolvedValue('processedResult'), // @ts-ignore
  slowOperation: jest.fn().mockResolvedValue('slowResult'), // @ts-ignore
  parallelTask1: jest.fn().mockResolvedValue('parallelResult1'), // @ts-ignore
  parallelTask2: jest.fn().mockResolvedValue('parallelResult2'), // @ts-ignore
  combineResults: jest.fn().mockResolvedValue('combinedResult'), // @ts-ignore
  complexOperation: jest.fn().mockResolvedValue('complexResult'), // @ts-ignore
  errorProneActivity: jest.fn().mockRejectedValue(new Error('Activity failed')), // @ts-ignore
  conditionalTask: jest
    .fn()
    .mockImplementation((condition) => Promise.resolve(condition === 'true' ? 'condition met' : 'condition not met')),
  // @ts-ignore
  processLargeFile: jest.fn().mockResolvedValue('processedResult')
};

global.tracer = initTracer('temporal_worker', 'local', 'http://localhost:4317/v1/traces')?.tracer;
global.exporter = getExporter('temporal_worker');
global.resource = getResource('temporal_worker');

// @ts-ignore
logger.trace = (...args) => logger.verbose(...args);

Runtime.install({
  telemetryOptions: {
    // metrics: { otel: { url: 'http://localhost:4317/v1/metrics' } },
    logging: { filter: makeTelemetryFilterString({ core: 'INFO', other: 'INFO' }) }
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
      activities,
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
      // reuseV8Context: true
    })
  );

  const runPromise = global.worker.run();
  global.shutdown = async () => {
    if (global.worker.getState() === 'RUNNING') {
      global.worker.shutdown();
    }
    await runPromise;
    await global.testEnv.teardown();
    // The Runtime is process-wide; with --runInBand the next test file creates its worker on the same Runtime.
  };
};
