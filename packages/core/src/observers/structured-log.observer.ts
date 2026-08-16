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

export interface StructuredLogger {
  log(message: string, context?: Record<string, unknown>): void;
  error(message: string, trace?: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  debug?(message: string, context?: Record<string, unknown>): void;
}

export interface StructuredLogObserverOptions {
  /** Logger implementation (e.g. NestJS LoggerService, Winston, Pino). Defaults to structured JSON console. */
  logger?: StructuredLogger;
  /** Whether to include raw prompt message arrays in debug logs. Default: false */
  includeModelPayloads?: boolean;
}

/**
 * Built-in observer that formats and outputs structured lifecycle logs
 * compatible with NestJS Logger, Winston, Pino, Datadog, and cloud loggers.
 */
export class StructuredLogObserver implements AgentObserver {
  private readonly logger: StructuredLogger;
  private readonly includeModelPayloads: boolean;

  constructor(options: StructuredLogObserverOptions = {}) {
    this.logger = options.logger ?? {
      log: (msg, ctx) => console.log(JSON.stringify({ level: 'info', msg, ...ctx })),
      error: (msg, trace, ctx) => console.error(JSON.stringify({ level: 'error', msg, trace, ...ctx })),
      warn: (msg, ctx) => console.warn(JSON.stringify({ level: 'warn', msg, ...ctx })),
      debug: (msg, ctx) => console.debug(JSON.stringify({ level: 'debug', msg, ...ctx })),
    };
    this.includeModelPayloads = options.includeModelPayloads ?? false;
  }

  onAgentStart(event: AgentStartEvent): void {
    this.logger.log('agent_started', {
      agentName: event.agentName,
      sessionId: event.sessionId,
      traceId: event.traceId,
      parentTraceId: event.parentTraceId,
      rootTraceId: event.rootTraceId,
      tenantId: event.tenantId,
      userId: event.userId,
    });
  }

  onAgentEnd(event: AgentEndEvent): void {
    this.logger.log('agent_completed', {
      agentName: event.agentName,
      sessionId: event.sessionId,
      traceId: event.traceId,
      tenantId: event.tenantId,
      durationMs: event.durationMs,
      totalTokensUsed: event.totalTokensUsed,
    });
  }

  onModelRequest(event: ModelRequestEvent): void {
    const meta: Record<string, unknown> = {
      agentName: event.agentName,
      sessionId: event.sessionId,
      traceId: event.traceId,
      model: event.model.model,
      roundIndex: event.roundIndex,
      messagesCount: event.messages.length,
    };
    if (this.includeModelPayloads) {
      meta.messages = event.messages;
    }
    this.logger.debug?.('model_request_dispatched', meta);
  }

  onModelResponse(event: ModelResponseEvent): void {
    this.logger.debug?.('model_response_received', {
      agentName: event.agentName,
      sessionId: event.sessionId,
      traceId: event.traceId,
      model: event.model.model,
      roundIndex: event.roundIndex,
      durationMs: event.durationMs,
      usage: event.usage,
      toolCallsCount: event.response.toolCalls?.length ?? 0,
    });
  }

  onToolCall(event: ToolCallEvent): void {
    this.logger.log('tool_call_initiated', {
      agentName: event.agentName,
      sessionId: event.sessionId,
      traceId: event.traceId,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      args: event.args,
    });
  }

  onToolResult(event: ToolResultEvent): void {
    this.logger.log('tool_result_received', {
      agentName: event.agentName,
      sessionId: event.sessionId,
      traceId: event.traceId,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      durationMs: event.durationMs,
    });
  }

  onError(event: AgentErrorEvent): void {
    this.logger.error(
      'agent_error_occurred',
      event.error.stack,
      {
        agentName: event.agentName,
        sessionId: event.sessionId,
        traceId: event.traceId,
        error: event.error.message,
        durationMs: event.durationMs,
      },
    );
  }
}
