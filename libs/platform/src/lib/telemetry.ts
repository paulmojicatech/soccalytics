import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

/**
 * Starts OpenTelemetry tracing (HTTP, Fastify, pg, ioredis auto-instrumented)
 * when OTEL_EXPORTER_OTLP_ENDPOINT is set. View traces in Jaeger at :16686.
 */
export function startTelemetry(serviceName: string): () => Promise<void> {
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (!endpoint) return async () => undefined;
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })],
  });
  sdk.start();
  return () => sdk.shutdown();
}
