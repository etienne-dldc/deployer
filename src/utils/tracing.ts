import {
  type Attributes,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

const TRACER_NAME = "controller";
const TRACER_VERSION = "0.1.0";

const tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);

export { tracer };

export function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, (span) =>
    fn(span)
      .catch((error) => {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      })
      .finally(() => {
        span.end();
      }));
}
