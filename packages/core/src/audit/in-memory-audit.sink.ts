import type { AuditEvent, AuditSink } from '../interfaces/audit.interface';

/**
 * Collects audit events in process.
 *
 * Intended for tests and local inspection — nothing is persisted, so a restart
 * loses the trail. Production deployments should write to a durable store.
 */
export class InMemoryAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = [];

  record(event: AuditEvent): void {
    this.events.push(event);
  }

  /** Every recorded event, oldest first. */
  all(): AuditEvent[] {
    return [...this.events];
  }

  /** Recorded events of one type, narrowed to that variant. */
  ofType<T extends AuditEvent['type']>(type: T): Extract<AuditEvent, { type: T }>[] {
    return this.events.filter(
      (event): event is Extract<AuditEvent, { type: T }> => event.type === type,
    );
  }

  clear(): void {
    this.events.length = 0;
  }
}
