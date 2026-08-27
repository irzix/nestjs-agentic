---
"@nestjs-agentic/core": minor
---

Add `DistributedRateLimitPolicy`, a sliding-window rate limiter enforced across every instance sharing one Redis, closing the gap where N pods each admitted the configured limit independently. Evict, count, and admit happen in a single Lua `EVAL`, so concurrent callers cannot both take the last slot; a client without `eval` is rejected at construction rather than silently degraded to a racy read-then-write. Each window key carries a `PEXPIRE` matching the window, so idle callers' keys expire on their own.

Denials now report back-off timing. `PolicyResult`'s `deny` variant gains an optional `retryAfterSeconds`, computed from the oldest call still inside the window rather than assuming a full window, surfaced in the reason text the model sees and recorded on the `tool_policy_decision` audit event. `RateLimitPolicy` reports it too.

Adds `runRateLimiterContract` to `@nestjs-agentic/core`'s testing exports — a behavioral contract for any rate-limit policy, whose combined-limit groups create two limiters over one backend and assert they share a single allowance, including a race for the final slot. Closes #142.
