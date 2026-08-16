import type { AuditEvent, AuditSink } from '../interfaces/audit.interface';
import { toOpenTelemetryGenAiAttributes } from './opentelemetry-genai.attributes';

/**
 * Options for configuring OpenTelemetryGenAiSink.
 */
export interface OpenTelemetryGenAiSinkOptions {
  /**
   * Override default system name in emitted OpenTelemetry telemetry.
   * Default: `'nestjs-agentic'`
   */
  system?: string;

  /**
   * Custom callback or tracer exporter to receive formatted OpenTelemetry GenAI attributes.
   */
  exporter?: (attributes: Record<string, unknown>, event: AuditEvent) => Promise<void> | void;
}

/**
 * AuditSink implementation mapping framework governance and execution events
 * directly to the CNCF OpenTelemetry Semantic Conventions for Generative AI.
 *
 * Implements resilient error isolation: failures in telemetry exporters are caught
 * and will not interrupt agent execution.
 *
 * @see OpenTelemetry GenAI Conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 * @see Task 07: 5-Tier Memory Hierarchy, Reflexion & OpenTelemetry
 */
export class OpenTelemetryGenAiSink implements AuditSink {
  private readonly system?: string;
  private readonly exporter: (attributes: Record<string, unknown>, event: AuditEvent) => Promise<void> | void;

  constructor(options?: OpenTelemetryGenAiSinkOptions) {
    this.system = options?.system;
    this.exporter = options?.exporter ?? ((attributes) => {
      if (process.env.OTEL_LOG_DEBUG === 'true') {
        console.debug('[OTel GenAI Telemetry]', JSON.stringify(attributes));
      }
      return Promise.resolve();
    });
  }

  /**
   * Formats and dispatches an audit event to the configured OpenTelemetry exporter with error isolation.
   *
   * @param event - Framework audit event record.
   */
  async record(event: AuditEvent): Promise<void> {
    const attributes = toOpenTelemetryGenAiAttributes(event, { system: this.system });

    try {
      await Promise.resolve(this.exporter(attributes, event));
    } catch (err: unknown) {
      if (process.env.OTEL_LOG_DEBUG === 'true') {
        console.warn('[OpenTelemetryGenAiSink] Exporter callback failed:', err);
      }
    }
  }
}
