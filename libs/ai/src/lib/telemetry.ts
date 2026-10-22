import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';

/** One LLM request, as persisted to the `llm_calls` ledger. */
export interface LlmCallRecord {
  id: string;
  task: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  stopReason: string | null;
  ok: boolean;
  error: string | null;
  subjectId: string | null;
}

/** Implemented by the host app (api/worker) to persist call records. */
export type UsageSink = (record: LlmCallRecord) => void | Promise<void>;

export const tracer = trace.getTracer('@soccalytics/ai');

export async function withSpan<T>(name: string, attrs: Record<string, string | number>, fn: (span: Span) => Promise<T>) {
  return tracer.startActiveSpan(name, { attributes: attrs }, async (span) => {
    try {
      const out = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
