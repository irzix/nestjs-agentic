export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the circuit. Default: `5` */
  failureThreshold?: number;

  /** How long the circuit stays open before a probe is allowed. Default: `30_000` */
  cooldownMs?: number;

  /** Consecutive successes in `half_open` that close the circuit. Default: `1` */
  successThreshold?: number;

  onStateChange?: (event: CircuitStateChangeEvent) => void;

  /** Injectable clock, for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface CircuitStateChangeEvent {
  name: string;
  from: CircuitState;
  to: CircuitState;
  failures: number;
  reason: string;
  at: Date;
}

export class CircuitOpenError extends Error {
  constructor(
    readonly circuitName: string,
    readonly retryAfterMs: number,
  ) {
    super(
      `Circuit "${circuitName}" is open after repeated failures; not dispatching. ` +
        `Retrying is allowed in ${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = 'CircuitOpenError';
  }
}

/**
 * Fails fast once a dependency has failed repeatedly, so one degraded provider
 * cannot keep every caller waiting for its timeout.
 *
 * State is per-instance and in-process: each replica detects an outage
 * independently, which avoids a network round trip on the fail-fast path.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private openedAt = 0;

  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly successThreshold: number;
  private readonly onStateChange?: (event: CircuitStateChangeEvent) => void;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    options?: CircuitBreakerOptions,
  ) {
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.cooldownMs = options?.cooldownMs ?? 30_000;
    this.successThreshold = options?.successThreshold ?? 1;
    this.onStateChange = options?.onStateChange;
    this.now = options?.now ?? Date.now;

    assertPositiveInteger('failureThreshold', this.failureThreshold);
    assertPositiveInteger('cooldownMs', this.cooldownMs);
    assertPositiveInteger('successThreshold', this.successThreshold);
  }

  currentState(): CircuitState {
    this.promoteIfCooledDown();
    return this.state;
  }

  failureCount(): number {
    return this.failures;
  }

  /** @throws {CircuitOpenError} If the circuit is open and its cooldown has not elapsed. */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.promoteIfCooledDown();

    if (this.state === 'open') {
      throw new CircuitOpenError(this.name, this.remainingCooldownMs());
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(describeError(err));
      throw err;
    }
  }

  recordSuccess(): void {
    if (this.state === 'half_open') {
      this.successes += 1;
      if (this.successes >= this.successThreshold) {
        this.transition('closed', 'probe succeeded');
      }
      return;
    }

    this.failures = 0;
  }

  recordFailure(reason = 'operation failed'): void {
    this.failures += 1;

    // A failed probe restarts the cooldown rather than allowing another probe.
    if (this.state === 'half_open') {
      this.transition('open', `probe failed: ${reason}`);
      return;
    }

    if (this.failures >= this.failureThreshold) {
      this.transition('open', `${this.failures} consecutive failures: ${reason}`);
    }
  }

  private remainingCooldownMs(): number {
    return Math.max(0, this.openedAt + this.cooldownMs - this.now());
  }

  private promoteIfCooledDown(): void {
    if (this.state === 'open' && this.remainingCooldownMs() === 0) {
      this.transition('half_open', 'cooldown elapsed, probing');
    }
  }

  private transition(to: CircuitState, reason: string): void {
    const from = this.state;
    if (from === to) return;

    this.state = to;

    if (to === 'open') {
      this.openedAt = this.now();
      this.successes = 0;
    } else if (to === 'closed') {
      this.failures = 0;
      this.successes = 0;
    } else {
      this.successes = 0;
    }

    this.onStateChange?.({
      name: this.name,
      from,
      to,
      failures: this.failures,
      reason,
      at: new Date(this.now()),
    });
  }
}

function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(
      `CircuitBreaker: ${field} must be a positive integer, received ${String(value)}.`,
    );
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
