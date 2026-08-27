import type { AgentContext } from './agent-context.interface';
import type { FactoryProvider } from '@nestjs/common';

import type { AuditActor } from './audit.interface';
import type { ModelMessage } from './model.interface';

/** Checkpoint schema version written by this release. */
export const APPROVAL_CHECKPOINT_VERSION = 1;

/**
 * A durable snapshot of the suspended turn, stored on the approval itself.
 *
 * Resuming needs the conversation up to and including the tool message that
 * was withheld. Reading it back from `SessionStore` is unreliable — that
 * transcript is trimmed for replay and may be cleared independently of the
 * approval — so the executor checkpoints it here instead, making resume
 * self-contained.
 *
 * `version` is explicit so a record written by an older release can be
 * recognized and rejected (`ApprovalCheckpointVersionError`) rather than
 * misread.
 */
export interface ApprovalCheckpoint {
  version: number;
  /**
   * Conversation up to and including the withheld tool message, untrimmed and
   * without system messages — instructions are re-derived from the agent's
   * `AgentConfig` on resume.
   */
  messages: ModelMessage[];
}

/**
 * A tool call withheld pending human approval.
 *
 * Fully serializable so a store can persist it across a process restart or a
 * different instance — there is no closure over live objects. Resuming a
 * pending approval re-resolves the agent, its tools, and the tool method
 * through DI using `agentName` and `toolName` rather than a captured
 * reference.
 */
export interface PendingApproval {
  id: string;
  /** Name of the @Agent that requested this call, used to resume its turn. */
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
  context: AgentContext;
  reason: string;
  createdAt: Date;
  /**
   * When set, the approval is no longer valid after this instant. Attempting
   * to resolve it past this point fails with `ApprovalExpiredError` rather
   * than executing a decision against stale context. Unset means the approval
   * never expires. Derived from a policy's `ttlSeconds` or the module's
   * `approvalTtlSeconds` when the approval is created.
   */
  expiresAt?: Date;
  /**
   * Identifier of the model tool call this approval corresponds to, when
   * known. Used to splice the eventual outcome back into the exact
   * conversation position that was suspended.
   */
  toolCallId?: string;
  /**
   * Snapshot of the suspended turn, written by the built-in runtime once the
   * approval is created. When present, resuming uses it instead of reading
   * `SessionStore`, so the turn survives history being trimmed or cleared.
   * Absent for approvals created outside the built-in runtime.
   */
  checkpoint?: ApprovalCheckpoint;
  /**
   * Identity that triggered the action being reviewed, derived from the
   * execution context when the approval was created. Recorded so a
   * separation-of-duties check can tell whether an approver is also the
   * requester. Absent when the application supplied no identity.
   */
  requestedBy?: AuditActor;
}

/**
 * Decides whether a caller may settle a pending approval. Register one through
 * the `APPROVAL_AUTHORIZER` token; consulted before the approval is claimed, so
 * a refusal leaves it pending.
 *
 * `actor` is application-supplied and not authenticated by the framework — see
 * `ApprovalGovernanceOptions`.
 *
 * @example
 * ```typescript
 * class MaintainerOnlyAuthorizer implements ApprovalAuthorizer {
 *   async canSettle(approval: PendingApproval, actor?: AuditActor) {
 *     return actor?.roles?.includes('maintainer') ?? false;
 *   }
 * }
 * ```
 */
export interface ApprovalAuthorizer {
  /**
   * @param approval The pending approval being settled.
   * @param actor Identity supplied by the caller, when any.
   * @returns `true`, or `{ allowed: false, reason }` to refuse with
   *   `ApprovalNotAuthorizedError`.
   */
  canSettle(
    approval: PendingApproval,
    actor?: AuditActor,
  ): Promise<boolean | ApprovalAuthorizationDecision> | boolean | ApprovalAuthorizationDecision;
}

/** Explicit authorization outcome, allowing a human-readable refusal reason. */
export type ApprovalAuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason?: string };

/**
 * How to register an `ApprovalAuthorizer`.
 *
 * Prefer `useClass` or `useFactory` in production: the authorizer is then
 * constructed by Nest, so it can inject its own dependencies (a user directory,
 * a repository) and participate in the normal provider lifecycle. A bare
 * instance is only appropriate for an authorizer that needs nothing injected.
 */
export type ApprovalAuthorizerRegistration =
  | ApprovalAuthorizer
  | { useClass: new (...args: never[]) => ApprovalAuthorizer }
  | {
      useFactory: (...args: never[]) => ApprovalAuthorizer | Promise<ApprovalAuthorizer>;
      /** Tokens injected into `useFactory`, in parameter order. */
      inject?: FactoryProvider['inject'];
    };

/**
 * Governance behavior for settling pending approvals.
 *
 * These checks run against the `actor` the application passes to
 * `ApprovalService.approve()` / `.reject()`. That actor is **not** authenticated
 * by the framework — it has no request context — so it must be derived from an
 * already-authenticated principal (e.g. in a NestJS guard), never from
 * client-supplied request data.
 */
export interface ApprovalGovernanceOptions {
  /**
   * Refuse a settlement when the approver is the identity that triggered the
   * action. Off by default, since not every deployment supplies identities on
   * both sides.
   *
   * Matching `userId`s are refused unless both tenants are present and provably
   * different — an unknown tenant on either side is not proof of a different
   * person. A missing `userId` cannot be shown to be the same person, so it is
   * not treated as a violation; use `requireAuthorizer` to block unidentified
   * settlements outright.
   */
  enforceSeparationOfDuties?: boolean;

  /**
   * Refuse a settlement whose approver is not in the approval's tenant. Off by
   * default; enable it in multi-tenant deployments so a leaked approval ID
   * cannot be settled from another tenant.
   */
  enforceTenantIsolation?: boolean;

  /**
   * Refuse every settlement unless an `ApprovalAuthorizer` is registered. Off by
   * default for backward compatibility; enable it to fail closed rather than let
   * any caller holding an approval ID settle it.
   */
  requireAuthorizer?: boolean;
}

export interface ApprovalStore {
  save(approval: PendingApproval): Promise<void>;
  get(id: string): Promise<PendingApproval | null>;
  delete(id: string): Promise<void>;
  /**
   * Atomically remove and return the approval, or return `null` if it is
   * absent — including because a concurrent caller already claimed it.
   *
   * This is the primitive that makes settlement exactly-once: `approve()` and
   * `reject()` claim an approval before executing its withheld tool, so a
   * given approval can be settled at most once even under concurrent calls or
   * a restart-triggered retry. Implementations MUST perform the read and
   * removal as a single atomic step (e.g. Redis `GETDEL`).
   *
   * A pending record MUST also be treated as immutable once saved: `save()` is
   * for creating an approval, not for mutating one that is awaiting a decision.
   * `ApprovalService` authorizes against a non-destructive read before claiming,
   * and rejects the settlement if the claimed record no longer matches the one it
   * authorized, so a store that mutates records in place will surface as refused
   * settlements rather than decisions applied to the wrong version.
   */
  claim(id: string): Promise<PendingApproval | null>;
}

/** A human reviewer's decision on a `PendingApproval`. */
export type ApprovalDecision = { approved: true } | { approved: false; reason?: string };
