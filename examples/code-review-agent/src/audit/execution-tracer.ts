/**
 * Telemetry and trace event collector that records millisecond-precision
 * execution timeline logs conforming to structured OpenTelemetry traces.
 */
export interface TraceEvent {
  stage: string;
  message: string;
  durationMs?: number;
  timestamp: number;
}

/**
 * Utility for tracking and formatting runtime execution trace logs for Njent reviews.
 */
export class ExecutionTracer {
  private readonly startTime: number;
  private readonly events: TraceEvent[] = [];

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Records a trace event with relative timestamp from start.
   *
   * @param stage Identifier for the pipeline stage (e.g. 'ingress', 'rag', 'multi-agent').
   * @param message Human-readable structured log message.
   * @param durationMs Optional duration spent on this specific step.
   */
  record(stage: string, message: string, durationMs?: number): void {
    this.events.push({
      stage,
      message,
      durationMs,
      timestamp: Date.now(),
    });
  }

  /**
   * Returns all recorded trace events.
   */
  getEvents(): TraceEvent[] {
    return [...this.events];
  }

  /**
   * Total elapsed time in milliseconds from tracer instantiation.
   */
  get totalDurationMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Formats the recorded events into an ASCII console / OTel trace log block.
   */
  formatLog(): string {
    const lines = this.events.map((event) => {
      const elapsedMs = event.timestamp - this.startTime;
      const seconds = Math.floor(elapsedMs / 1000);
      const ms = elapsedMs % 1000;
      const timeStr = `[${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${String(ms).padStart(3, '0')}]`;
      const durStr = event.durationMs !== undefined ? ` (${event.durationMs}ms)` : '';
      return `${timeStr} ${event.message}${durStr}`;
    });

    return lines.join('\n');
  }
}
