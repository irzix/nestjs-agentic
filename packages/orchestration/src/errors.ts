/**
 * Base error class for orchestration exceptions.
 */
export class OrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when sub-agent delegation exceeds the maximum allowed recursion depth.
 */
export class MaxDelegationDepthExceededError extends OrchestrationError {
  constructor(
    public readonly currentDepth: number,
    public readonly maxDepth: number,
    public readonly agentName: string,
  ) {
    super(
      `Max delegation depth exceeded: Delegation to sub-agent "${agentName}" reached depth ${currentDepth} ` +
        `(max allowed: ${maxDepth}).`,
    );
  }
}

/**
 * Thrown when a sub-agent attempts to execute a tool outside its delegated capability whitelist
 * or inside its prohibited blacklist.
 */
export class CapabilityDeniedError extends OrchestrationError {
  constructor(
    public readonly toolName: string,
    public readonly reason: string,
  ) {
    super(`Capability denied for tool "${toolName}": ${reason}`);
  }
}

/**
 * Thrown when a delegated task attempts to request permissions or roles that the parent context does not hold.
 */
export class CapabilityEscalationError extends OrchestrationError {
  constructor(
    public readonly requestedCapabilities: string[],
    public readonly parentCapabilities: string[],
    public readonly type: 'permissions' | 'roles',
  ) {
    super(
      `Capability escalation forbidden: Sub-agent requested ${type} [${requestedCapabilities.join(', ')}] ` +
        `which are not held by parent context [${parentCapabilities.join(', ')}].`,
    );
  }
}

/**
 * Thrown when an iterative refinement loop exceeds its cumulative token or duration budget.
 */
export class RefinementBudgetExceededError extends OrchestrationError {
  constructor(
    public readonly budgetType: 'tokens' | 'duration',
    public readonly current: number,
    public readonly limit: number,
  ) {
    super(
      `Refinement loop budget exceeded: ${budgetType} consumption (${current}) exceeded limit (${limit}).`,
    );
  }
}

/**
 * Thrown when attempting to run or resume a refinement loop that is already locked and running by another worker.
 */
export class RefinementLoopAlreadyRunningError extends OrchestrationError {
  constructor(public readonly sessionId: string, public readonly agentName: string) {
    super(
      `Refinement loop for session "${sessionId}" and agent "${agentName}" is currently locked and active in another process.`,
    );
  }
}

/**
 * Thrown when resuming a checkpoint that requires a feedback provider function but none was provided.
 */
export class MissingFeedbackProviderError extends OrchestrationError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when a requested refinement loop checkpoint is not found in the StateStore.
 */
export class RefinementCheckpointNotFoundError extends OrchestrationError {
  constructor(public readonly checkpointKey: string) {
    super(`Refinement loop checkpoint not found for key: "${checkpointKey}".`);
  }
}

/**
 * Thrown when attempting to resume a refinement loop from an unsupported checkpoint schema version.
 */
export class RefinementCheckpointVersionError extends OrchestrationError {
  constructor(public readonly version: number, public readonly supportedVersion: number) {
    super(
      `Unsupported refinement loop checkpoint schema version: ${version} (expected: ${supportedVersion}).`,
    );
  }
}

/**
 * Thrown when an optimistic concurrency control conflict occurs while writing a refinement loop checkpoint.
 */
export class RefinementCheckpointConflictError extends OrchestrationError {
  constructor(
    public readonly checkpointKey: string,
    public readonly attemptedSequence: number,
    public readonly currentSequence: number,
  ) {
    super(
      `Refinement checkpoint conflict for "${checkpointKey}": Cannot write checkpoint sequence ${attemptedSequence} ` +
        `when existing sequence is already ${currentSequence}.`,
    );
  }
}
