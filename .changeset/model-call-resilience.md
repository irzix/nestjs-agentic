---
'@nestjs-agentic/core': minor
---

Add framework-level resilience for model calls: retry with exponential backoff and jitter, plus a circuit breaker that fails fast during a provider outage.

Configure through `AgenticModule.forRoot({ resilience: { retry, circuitBreaker } })`. Both are opt-in and leave model calls unwrapped when unset, so existing behavior is unchanged.

- `retryWithBackoff`, `isRetryableModelError`, `readRetryAfterMs` — retry primitives. Retries `429`/`5xx`/network errors, never `AgenticError` or aborts, and honors a provider's `Retry-After` hint over the computed delay.
- `CircuitBreaker`, `CircuitOpenError` — closed/open/half-open breaker with a configurable failure threshold, cooldown, and success threshold.
- `ResilientModelAdapter` — composes both around any `ModelAdapter`. The breaker sits outside the retry, so exhausted retries count as a single failure. Streams are retried only before the first chunk is emitted.
- New observer hooks `onModelRetry` and `onCircuitStateChange` on `AgentObserver`.
