import { Runtime } from '@temporalio/worker';
import { initTracer } from '../utils/instrumentation';
import { logger } from '../utils/logger';
export const tracer = initTracer('temporal_worker', 'local', 'http://localhost:4317/v1/traces');

// @ts-ignore
logger.trace = (...args) => logger.debug(...args);

Runtime.install({
  telemetryOptions: {
    metrics: { otel: { url: 'http://localhost:4317/v1/metrics' } },
    logging: {}
  },
  // @ts-ignore
  logger
});
