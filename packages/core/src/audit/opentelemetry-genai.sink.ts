import type { AuditEvent, AuditSink } from '../interfaces/audit.interface';
import { toOpenTelemetryGenAiAttributes } from './opentelemetry-genai.attributes';

/**
 * Options for configuring OpenTelemetryGenAiSink.
 */
export interface OpenTelemetryGenAiSinkOptions {
  /**
   * Custom callback or tracer exporter to receive formatted OpenTelemetry GenAI attributes.
   */
  exporter?: (attributes: Record<string, unknown>, event: AuditEvent) => void | Promise<void>;
}

/**
 * AuditSink implementation mapping framework governance and execution events
 * directly to the CNCF OpenTelemetry Semantic Conventions for Generative AI.
 *
 * @see OpenTelemetry GenAI Conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 * @see Task 07: 5-Tier Memory Hierarchy, Reflexion & OpenTelemetry
 */
export class OpenTelemetryGenAiSink implements AuditSink {
  private readonly exporter: (attributes: Record<string, unknown>, event: AuditEvent) => void | Promise<void>;

  constructor(options?: OpenTelemetryGenAiSinkOptions) {
    this.exporter = options?.exporter ?? ((attributes) => {
      // Default: emit structured telemetry line
      if (process.env.OTEL_LOG_DEBUG === 'true') {
        console.debug('[OTel GenAI Telemetry]', JSON.stringify(attributes));
      }
    });
  }

  async record(event: AuditEvent): Promise<void> {
    const attributes = toOpenTelemetryGenAiAttributes(event);
    await this.exporter(attributes, event);
  }
}
