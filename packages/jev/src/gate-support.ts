import * as core from '@nestjs-agentic/core';
import { CircuitBreaker, ExecutionCancelledError } from '@nestjs-agentic/core';
import type { AgentContext } from '@nestjs-agentic/core';
import { assertTimeout } from './ask-jev';
import type { JevCallOptions, JevClient } from './jev.interface';
import type { JevDefaults } from './jev.module';

const usedDefaultNames = new Set<string>();

/**
 * The class name of a gate, which core uses as the policy's identity on the
 * audit trail and as a fallback when resolving `@UsePolicies` classes. An
 * explicit `name` is kept; unnamed gates get distinct names (`JevActionGate`,
 * then `JevActionGate#2`, ...), so one unnamed gate never stands in for
 * another.
 */
export function gateName(kind: string, explicit: string | undefined): string {
  if (explicit !== undefined) return explicit;
  let name = kind;
  for (let n = 2; usedDefaultNames.has(name); n++) name = `${kind}#${n}`;
  usedDefaultNames.add(name);
  return name;
}

/** A cancelled run surfaces as cancellation, not as a Jev outage that `onError` decides. */
export function throwIfCancelled(ctx: AgentContext): void {
  if (ctx.signal?.aborted) throw new ExecutionCancelledError();
}

/** The client, model, timeout, and breaker a gate calls Jev with. */
export interface ResolvedJevCall {
  client: JevClient;
  model?: string;
  timeoutMs?: number;
  circuitBreaker?: CircuitBreaker;
}

/**
 * Resolves a gate's call settings. A gate's own `client` brings its own
 * defaults: the module's `model` and breaker belong to the module's client.
 */
export function resolveJevCall(
  name: string,
  options: JevCallOptions,
  moduleClient: JevClient | undefined,
  defaults: JevDefaults,
): ResolvedJevCall {
  const ownClient = options.client !== undefined;
  const client = options.client ?? moduleClient;
  if (!client) {
    throw new Error(`${name} has no Jev client: pass \`client\` in its options or import JevModule.forRoot().`);
  }
  const timeoutMs = options.timeoutMs ?? defaults.timeoutMs;
  assertTimeout(timeoutMs, name);

  let circuitBreaker: CircuitBreaker | undefined;
  if (options.circuitBreaker === false) circuitBreaker = undefined;
  else if (options.circuitBreaker) circuitBreaker = options.circuitBreaker;
  else circuitBreaker = ownClient ? new CircuitBreaker(name) : defaults.circuitBreaker;

  return {
    client,
    model: options.model ?? (ownClient ? undefined : defaults.model),
    timeoutMs,
    circuitBreaker,
  };
}

/**
 * Throws when the installed core predates dual control, which would accept a
 * `requiredApprovals` above 1 and let a single approver settle the call.
 */
export function assertDualControlSupported(name: string): void {
  if (typeof (core as unknown as Record<string, unknown>).ApprovalSignaturesUnsupportedError !== 'function') {
    throw new Error(
      `${name} sets requiredApprovals, but the installed @nestjs-agentic/core does not enforce multiple approvers. Upgrade it to 1.6.0 or later.`,
    );
  }
}
