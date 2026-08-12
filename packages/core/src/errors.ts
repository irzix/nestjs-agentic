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
