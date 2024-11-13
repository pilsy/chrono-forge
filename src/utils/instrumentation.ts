/* eslint-disable @typescript-eslint/ban-ts-comment */
'use strict';

import { Span, Tracer, default as api } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator, W3CBaggagePropagator, CompositePropagator } from '@opentelemetry/core';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { Resource } from '@opentelemetry/resources';
import { AlwaysOnSampler, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/tracing';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { ClientRequest, IncomingMessage, ServerResponse } from 'http';

import { logs } from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { logger } from './logger';

let contextManager: AsyncHooksContextManager;
let loggerProvider: LoggerProvider;
let resource: Resource;

export type TracerDefinition = {
  tracer: Tracer;
  resource: Resource;
  provider: NodeTracerProvider;
  exporter: OTLPTraceExporter;
};

export const tracers = new Map<string, TracerDefinition>();

export function initTracer(serviceName: string, environmentName: string, url: string): TracerDefinition {
  if (!contextManager) {
    contextManager = new AsyncHooksContextManager().enable();
    api.context.setGlobalContextManager(contextManager);
  }
  if (!tracers.has(serviceName)) {
    resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environmentName
    });

    const provider = new NodeTracerProvider({
      resource,
      sampler: new AlwaysOnSampler()
    });

    const exporter = new OTLPTraceExporter({
      url
    });

    provider.addSpanProcessor(
      // @ts-ignore
      new BatchSpanProcessor(exporter) // @ts-ignore
    );

    api.trace.setGlobalTracerProvider(provider);
    api.propagation.setGlobalPropagator(
      new CompositePropagator({
        propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()]
      })
    );

    loggerProvider = new LoggerProvider({
      resource
    });
    loggerProvider.addLogRecordProcessor(
      // @ts-ignore
      new BatchLogRecordProcessor( // @ts-ignore
        new OTLPLogExporter({
          url
        })
      )
    );
    logs.setGlobalLoggerProvider(loggerProvider);
    ['SIGINT', 'SIGTERM'].forEach((signal) => {
      process.on(signal, () => loggerProvider.shutdown().catch(console.error));
    });

    registerInstrumentations({
      instrumentations: [
        ...getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false
          },
          '@opentelemetry/instrumentation-dns': {
            enabled: true
          },
          '@opentelemetry/instrumentation-http': {
            requestHook,
            responseHook
          },
          '@opentelemetry/instrumentation-grpc': {
            enabled: true
          },
          '@opentelemetry/instrumentation-winston': {
            enabled: true
          },
          '@opentelemetry/instrumentation-ioredis': {
            enabled: true
          }
        })
      ],
      tracerProvider: provider,
      loggerProvider
    });

    ['SIGINT', 'SIGTERM'].forEach((signal) => {
      process.on(signal, () => provider.shutdown().catch(console.error));
      process.on(signal, () => exporter.shutdown().catch(console.error));
    });

    tracers.set(serviceName, {
      tracer: provider.getTracer(serviceName),
      resource,
      provider,
      exporter
    });
  }

  // @ts-ignore
  return tracers.get(serviceName);
}

export function getTracer(serviceName: string): Tracer {
  const tracer = tracers.get(serviceName)?.tracer as Tracer;
  if (!tracer) {
    throw new Error(`Tracer for service ${serviceName} not initialized`);
  }
  return tracer;
}

export function getExporter(serviceName: string): OTLPTraceExporter {
  const exporter = tracers.get(serviceName)?.exporter as OTLPTraceExporter;
  if (!exporter) {
    throw new Error(`Tracer for service ${serviceName} not initialized`);
  }
  return exporter;
}

export function getResource(serviceName: string): Resource {
  const resource = tracers.get(serviceName)?.resource as Resource;
  if (!resource) {
    throw new Error(`Resource for service ${serviceName} not initialized`);
  }
  return resource;
}

export async function requestHook(span: Span, request: ClientRequest | IncomingMessage): Promise<void> {
  let body = '';
  request.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  request.on('end', () => {
    logger.debug(body);
    request.removeAllListeners();
  });
}

export async function responseHook(span: Span, response: IncomingMessage | ServerResponse): Promise<void> {
  let body = '';
  response.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  response.on('end', () => {
    logger.debug(body);
    response.removeAllListeners();
  });
}
