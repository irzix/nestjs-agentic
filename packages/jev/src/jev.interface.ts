import type { CircuitBreaker } from '@nestjs-agentic/core';

/**
 * The part of the TypeSafe API client this package uses. `TypeSafeClient` from
 * `@typesafe-ai/sdk` satisfies it, and so can a fake in tests or a client
 * routed through a proxy.
 */
export interface JevClient {
  systemOne(request: JevRequest, options?: JevRequestOptions): PromiseLike<JevResult>;
}

/** What Jev is asked to judge: text, a JSON object or array, or `null`. */
export type JevState = string | { [key: string]: unknown } | unknown[] | null;

/** A yes/no question; the answer is the probability of yes. */
export interface JevNoulQuestion {
  type: 'noul';
  instructions?: JevState;
  criteria?: { true?: JevState; false?: JevState } | null;
}

/** Picks one label from a set; the answer carries a probability per label. */
export interface JevChoiceQuestion {
  type: 'choice';
  instructions?: JevState;
  criteria: { [label: string]: JevState };
}

/** Places the state on an ordered rubric, indexed from 0. */
export interface JevScoreQuestion {
  type: 'score';
  instructions?: JevState;
  criteria: readonly [JevState, JevState, ...JevState[]];
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

export interface JevRequest {
  state: JevState;
  questions: { [name: string]: JevQuestion };
  /** Model override, e.g. a pinned `jev-1.13.0`. Defaults to the client's model. */
  model?: string;
}

export interface JevRequestOptions {
  signal?: AbortSignal;
  /** Per-attempt timeout in milliseconds. */
  timeout?: number;
}

export interface JevNoulAnswer {
  readonly type: 'noul';
  /** Probability of yes, 0 to 1. */
  readonly noul: number;
}

export interface JevChoiceAnswer {
  readonly type: 'choice';
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: { readonly [label: string]: number };
}

export interface JevScoreAnswer {
  readonly type: 'score';
  /** Expected rubric position, which can fall between levels. */
  readonly score: number;
  readonly confidence: number;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevResult {
  readonly model: string;
  readonly answers: { readonly [name: string]: JevAnswer };
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number };
}

/** Settings shared by everything that calls Jev. */
export interface JevCallOptions {
  /**
   * Client to call. Optional when `JevModule.forRoot()` provides one; an
   * explicit client wins.
   */
  client?: JevClient;
  /**
   * Model, e.g. `'jev-latest'` or a pinned version. Defaults to `JevModule`'s
   * `model` when the module's client is used, otherwise to the client's own.
   */
  model?: string;
  /**
   * Upper bound on one call in milliseconds, retries included. Exceeding it
   * counts as an error and follows the caller's `onError`. A positive number
   * up to 2147483647 (about 24.8 days). Default: `5000`.
   */
  timeoutMs?: number;
  /**
   * Fails Jev calls fast after repeated failures (errors, timeouts, or
   * malformed answers), so an outage does not make every call wait for
   * `timeoutMs`. A failed-fast call follows `onError`
   * like any other failure. `false` turns it off.
   *
   * Gates default to the breaker of `JevModule`, or to one of their own when
   * given their own `client`; judges have none unless one is passed.
   */
  circuitBreaker?: CircuitBreaker | false;
}
