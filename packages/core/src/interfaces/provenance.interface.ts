/**
 * Trust/origin classification for a piece of content flowing through an agent.
 *
 * - `model`: produced by the model's own reasoning.
 * - `tool`: returned by a tool the framework executed.
 * - `external`: originated from an untrusted external source (a scraped document,
 *   a webhook payload, a third-party API response, a retrieved RAG chunk).
 * - `user`: supplied directly by the end user.
 */
export type ProvenanceSource = 'model' | 'tool' | 'external' | 'user';

/**
 * Optional provenance/trust label attached to content (tool results, retrieved
 * chunks, conversation messages) so downstream policies, audit sinks, and observers
 * can reason about *where content came from*, not just what it says.
 *
 * This is the structural prerequisite for trust-aware guardrails: known-bad patterns
 * can be sanitized without provenance, but distinguishing "the model said this" from
 * "an untrusted document said this" requires an origin label.
 */
export interface Provenance {
  /** Coarse trust classification of the content. */
  source: ProvenanceSource;

  /**
   * Optional finer-grained origin identifier — e.g. the tool name, a document
   * source URL, or a retrieval store id — for auditing and debugging.
   */
  origin?: string;
}
