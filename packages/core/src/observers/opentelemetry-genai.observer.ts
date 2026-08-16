import type {
  AgentEndEvent,
  AgentErrorEvent,
  AgentObserver,
  AgentStartEvent,
  ModelRequestEvent,
  ModelResponseEvent,
  ToolCallEvent,
  ToolResultEvent,
} from '../interfaces/observer.interface';

/**
 * OpenTelemetry GenAI Span / Event Record emitted by OpenTelemetryGenAiObserver.
 */
export interface OpenTelemetryGenAiRecord {
  name: string;
  attributes: Record<string, unknown>;
  timestamp: Date;
  durationMs?: number;
}

export interface OpenTelemetryGenAiObserverOptions {
  /**
   * Override default system name in emitted OpenTelemetry telemetry.
   * Default: `'nestjs-agentic'`
   */
  system?: string;

  /**
   * Custom callback or tracer exporter to receive formatted OpenTelemetry GenAI records.
   */
  exporter?: (record: OpenTelemetryGenAiRecord) => Promise<void> | void;
}

/**
 * OpenTelemetry GenAI Observer implementing official CNCF Semantic Conventions
 * for Generative AI systems, tracing agent turns, model iterations, tool calls,
 * token consumption, and execution latencies.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
export class OpenTelemetryGenAiObserver implements AgentObserver {
  private readonly defaultSystem: string;
  private readonly exporter: (record: OpenTelemetryGenAiRecord) => Promise<void> | void;
  readonly records: OpenTelemetryGenAiRecord[] = [];

  constructor(options?: OpenTelemetryGenAiObserverOptions) {
    this.defaultSystem = options?.system ?? 'nestjs-agentic';
    this.exporter = options?.exporter ?? ((record) => {
      if (process.env.OTEL_LOG_DEBUG === 'true') {
        console.debug('[OTel GenAI Observer]', JSON.stringify(record));
      }
      return Promise.resolve();
    });
  }

  async onAgentStart(event: AgentStartEvent): Promise<void> {
    const attributes: Record<string, unknown> = {
      'gen_ai.operation.name': 'agent',
      'gen_ai.system': this.defaultSystem,
      'gen_ai.agent.name': event.agentName,
      'gen_ai.agent.session_id': event.sessionId,
      'gen_ai.agent.turn_id': event.traceId,
      'gen_ai.trace.id': event.traceId,
    };

    if (event.tenantId) attributes['gen_ai.tenant.id'] = event.tenantId;
    if (event.userId) attributes['gen_ai.user.id'] = event.userId;

    await this.emit({
      name: `agent ${event.agentName} start`,
      attributes,
      timestamp: event.timestamp,
    });
  }

  async onAgentEnd(event: AgentEndEvent): Promise<void> {
    const attributes: Record<string, unknown> = {
      'gen_ai.operation.name': 'agent',
      'gen_ai.system': this.defaultSystem,
      'gen_ai.agent.name': event.agentName,
      'gen_ai.agent.session_id': event.sessionId,
      'gen_ai.agent.turn_id': event.traceId,
      'gen_ai.trace.id': event.traceId,
      'gen_ai.duration_ms': event.durationMs,
    };

    if (event.tenantId) attributes['gen_ai.tenant.id'] = event.tenantId;
    if (event.totalTokensUsed !== undefined) {
      attributes['gen_ai.usage.total_tokens'] = event.totalTokensUsed;
    }

    await this.emit({
      name: `agent ${event.agentName} end`,
      attributes,
      durationMs: event.durationMs,
      timestamp: event.timestamp,
    });
  }

  async onModelRequest(event: ModelRequestEvent): Promise<void> {
    const attributes: Record<string, unknown> = {
      'gen_ai.operation.name': 'chat',
      'gen_ai.system': event.model.provider || this.defaultSystem,
      'gen_ai.request.model': event.model.model,
      'gen_ai.agent.name': event.agentName,
      'gen_ai.agent.session_id': event.sessionId,
      'gen_ai.agent.turn_id': event.traceId,
      'gen_ai.agent.round_index': event.roundIndex,
      'gen_ai.request.messages_count': event.messages.length,
    };

    await this.emit({
      name: `model request ${event.model.model}`,
      attributes,
      timestamp: event.timestamp,
    });
  }

  async onModelResponse(event: ModelResponseEvent): Promise<void> {
    const attributes: Record<string, unknown> = {
      'gen_ai.operation.name': 'chat',
      'gen_ai.system': event.model.provider || this.defaultSystem,
      'gen_ai.response.model': event.model.model,
      'gen_ai.agent.name': event.agentName,
      'gen_ai.agent.session_id': event.sessionId,
      'gen_ai.agent.turn_id': event.traceId,
      'gen_ai.agent.round_index': event.roundIndex,
      'gen_ai.duration_ms': event.durationMs,
    };

    if (event.usage) {
      if (event.usage.inputTokens !== undefined) {
        attributes['gen_ai.usage.prompt_tokens'] = event.usage.inputTokens;
        attributes['gen_ai.usage.input_tokens'] = event.usage.inputTokens;
      }
      if (event.usage.outputTokens !== undefined) {
        attributes['gen_ai.usage.completion_tokens'] = event.usage.outputTokens;
        attributes['gen_ai.usage.output_tokens'] = event.usage.outputTokens;
      }
      if (event.usage.totalTokens !== undefined) {
        attributes['gen_ai.usage.total_tokens'] = event.usage.totalTokens;
      }
    }

    if (event.response.toolCalls?.length) {
      attributes['gen_ai.response.tool_calls_count'] = event.response.toolCalls.length;
    }

    await this.emit({
      name: `model response ${event.model.model}`,
      attributes,
      durationMs: event.durationMs,
      timestamp: event.timestamp,
    });
  }

  async onToolCall(event: ToolCallEvent): Promise<void> {
    const attributes: Record<string, unknown> = {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.system': this.defaultSystem,
      'gen_ai.agent.name': event.agentName,
      'gen_ai.agent.session_id': event.sessionId,
      'gen_ai.agent.turn_id': event.traceId,
      'gen_ai.tool.name': event.toolName,
      'gen_ai.tool.call_id': event.toolCallId,
    };

    await this.emit({
      name: `tool call ${event.toolName}`,
      attributes,
      timestamp: event.timestamp,
    });
  }

  async onToolResult(event: ToolResultEvent): Promise<void> {
    const attributes: Record<string, unknown> = {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.system': this.defaultSystem,
      'gen_ai.agent.name': event.agentName,
      'gen_ai.agent.session_id': event.sessionId,
      'gen_ai.agent.turn_id': event.traceId,
      'gen_ai.tool.name': event.toolName,
      'gen_ai.tool.call_id': event.toolCallId,
      'gen_ai.duration_ms': event.durationMs,
    };

    await this.emit({
      name: `tool result ${event.toolName}`,
      attributes,
      durationMs: event.durationMs,
      timestamp: event.timestamp,
    });
  }

  async onError(event: AgentErrorEvent): Promise<void> {
    const attributes: Record<string, unknown> = {
      'gen_ai.operation.name': 'agent',
      'gen_ai.system': this.defaultSystem,
      'gen_ai.agent.name': event.agentName,
      'gen_ai.agent.session_id': event.sessionId,
      'gen_ai.agent.turn_id': event.traceId,
      'gen_ai.error.type': event.error.name || 'Error',
      'gen_ai.error.message': event.error.message,
      'gen_ai.duration_ms': event.durationMs,
    };

    await this.emit({
      name: `agent error ${event.agentName}`,
      attributes,
      durationMs: event.durationMs,
      timestamp: event.timestamp,
    });
  }

  private async emit(record: OpenTelemetryGenAiRecord): Promise<void> {
    this.records.push(record);
    try {
      await Promise.resolve(this.exporter(record));
    } catch (err: unknown) {
      if (process.env.OTEL_LOG_DEBUG === 'true') {
        console.warn('[OpenTelemetryGenAiObserver] Exporter callback failed:', err);
      }
    }
  }
}
