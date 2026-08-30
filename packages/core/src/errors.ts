import type { ExecutionLimitKind } from './interfaces/execution.interface';

/** Base class for errors raised by the framework runtime. */
export class AgenticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raised when model-supplied tool arguments do not satisfy the declared
 * parameter schema. The executor reports this back to the model instead of
 * invoking the application method with invalid input.
 */
export class ToolValidationError extends AgenticError {
  constructor(
    readonly toolName: string,
    readonly issues: string[],
  ) {
    super(`Invalid arguments for tool "${toolName}": ${issues.join('; ')}`);
  }
}

/** Raised when a configured execution budget is exhausted. */
export class ExecutionLimitExceededError extends AgenticError {
  constructor(
    readonly kind: ExecutionLimitKind,
    readonly limit: number,
  ) {
    super(`Execution stopped: ${kind} limit of ${limit} was reached.`);
  }
}

/** Raised when an execution is aborted through its AbortSignal. */
export class ExecutionCancelledError extends AgenticError {
  constructor(reason?: string) {
    super(reason ? `Execution cancelled: ${reason}` : 'Execution cancelled.');
  }
}

/**
 * Raised when a tool declares a policy that was never registered.
 *
 * This is a configuration mistake rather than a recoverable tool failure, so the
 * runtime surfaces it to the caller instead of reporting it to the model.
 */
export class PolicyNotRegisteredError extends AgenticError {
  constructor(readonly policyName: string) {
    super(
      `Policy "${policyName}" is not registered. ` +
        `Add it to AgenticModule.forFeature({ policies: [${policyName}] }).`,
    );
  }
}

/** Raised when no runtime is available to execute an agent. */
export class RuntimeNotConfiguredError extends AgenticError {
  constructor() {
    super(
      'No runtime is configured. Register a ModelAdapter with the MODEL_ADAPTER token ' +
        'to use the built-in agent runtime, or a RuntimeAdapter with RUNTIME_ADAPTER ' +
        'to delegate execution to an external runtime.',
    );
  }
}

/**
 * Raised when `ApprovalService.approve()` or `.reject()` is called with an ID
 * that is unknown to the configured `ApprovalStore`, including because it was
 * already resolved.
 */
export class ApprovalNotFoundError extends AgenticError {
  constructor(readonly approvalId: string) {
    super(`Approval "${approvalId}" not found or has already been processed.`);
  }
}

/**
 * Raised when `ApprovalService.approve()` or `.reject()` is called for an
 * approval whose `expiresAt` has already passed. The approval is consumed
 * (removed from the store) rather than executed against stale context.
 */
export class ApprovalExpiredError extends AgenticError {
  constructor(
    readonly approvalId: string,
    readonly expiredAt: Date,
  ) {
    super(
      `Approval "${approvalId}" expired at ${expiredAt.toISOString()} and can no longer be resolved.`,
    );
  }
}

/**
 * Raised when a settlement attempt is refused before the approval is claimed,
 * by tenant isolation, separation of duties, or a registered
 * `ApprovalAuthorizer`. The approval is left pending so a properly authorized
 * reviewer can still resolve it.
 */
export class ApprovalNotAuthorizedError extends AgenticError {
  /**
   * @param approvalId The approval the caller attempted to settle.
   * @param reason Why the attempt was refused.
   */
  constructor(
    readonly approvalId: string,
    readonly reason: string,
  ) {
    super(`Not authorized to settle approval "${approvalId}": ${reason}`);
  }
}

/**
 * Raised when a pending approval is resumed but its tool can no longer be
 * found among the agent's current tool sets — for example the tool was
 * renamed or removed after the approval was created.
 */
export class ApprovalToolNotFoundError extends AgenticError {
  constructor(readonly toolName: string) {
    super(`Tool "${toolName}" was not found while resuming a pending approval.`);
  }
}

/**
 * Raised when resuming a suspended turn cannot locate the tool message it
 * withheld.
 *
 * Approvals created by the built-in runtime carry their own checkpoint, so
 * this normally indicates the approval predates checkpointing (or came from a
 * `RuntimeAdapter`) and the session history it fell back to was cleared or
 * trimmed past the suspension point.
 */
export class ApprovalTranscriptMissingError extends AgenticError {
  constructor(readonly toolCallId: string) {
    super(
      `Could not resume: no suspended tool call "${toolCallId}" was found in the ` +
        `approval checkpoint or the conversation history. The session may have ` +
        `been cleared or trimmed.`,
    );
  }
}

/**
 * Raised when a pending approval carries a checkpoint written in a schema
 * version this release does not understand, rather than misreading it.
 */
export class ApprovalCheckpointVersionError extends AgenticError {
  constructor(
    readonly approvalId: string,
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      `Approval "${approvalId}" has a checkpoint of version ${found}, but this ` +
        `release supports version ${supported}. The approval cannot be resumed safely.`,
    );
  }
}

/**
 * Raised when an in-flight execution checkpoint carries an unsupported schema version.
 */
export class InFlightCheckpointVersionError extends AgenticError {
  constructor(
    readonly executionId: string,
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      `Execution checkpoint "${executionId}" has version ${found}, but this ` +
        `release supports version ${supported}. The checkpoint cannot be resumed safely.`,
    );
  }
}

/**
 * Raised when attempting to recover an execution from a checkpoint that does not exist.
 */
export class CheckpointNotFoundError extends AgenticError {
  constructor(readonly identifier: string) {
    super(`Execution checkpoint "${identifier}" was not found or has expired.`);
  }
}

/**
 * Raised when a configured `AgentMessageReducer` returns a projection that
 * violates the tool protocol — an orphan `role: "tool"` message, an assistant
 * tool-call group missing one of its results, a dropped pending-approval group,
 * or a mutation of the input transcript.
 *
 * This is a bug in the reducer rather than a recoverable tool failure, so the
 * runtime surfaces it to the caller instead of sending an invalid payload to
 * the provider, which would reject it anyway.
 */
export class MessageReducerContractError extends AgenticError {
  constructor(readonly reason: string) {
    super(`Message reducer produced an invalid projection: ${reason}`);
  }
}

/**
 * Base error class for all FrugalGPT model cascading exceptions.
 */
export class CascadeError extends AgenticError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Raised when all model cascade tiers are exhausted without reaching the required confidence threshold.
 */
export class CascadeExhaustedError extends CascadeError {
  constructor(
    readonly tiersAttempted: number,
    readonly lastConfidence: number,
    readonly threshold: number,
    readonly lastModelName: string,
  ) {
    super(
      `Model cascade exhausted: Attempted ${tiersAttempted} tiers. Final model "${lastModelName}" achieved confidence ${lastConfidence.toFixed(2)}, below required threshold ${threshold.toFixed(2)}.`,
    );
  }
}

/**
 * Raised when an invalid or malformed cascade configuration is supplied.
 */
export class CascadeConfigurationError extends CascadeError {
  constructor(readonly reason: string) {
    super(`Invalid Model Cascade configuration: ${reason}`);
  }
}
