---
'@nestjs-agentic/core': patch
---

Fix `RateLimitPolicy`'s shared history `Map` growing unboundedly. A key (`` scopeKey(tenantId, userId, toolName) ``) was created on first call and never removed, even once every timestamp in its window had expired — every distinct (tenant, user, tool) combination ever seen stayed in memory for the life of the process.

- Added an opportunistic sweep, run at most once per `sweepIntervalMs` (default 5 minutes, configurable, `0` to sweep on every call), that evicts any history entry whose entire window has fully expired rather than just filtering its (now-empty) timestamp array.
- The sweep runs lazily on the next `evaluate()` call after the interval elapses — not on a `setInterval` timer — so it never keeps the process alive and needs no explicit shutdown/cleanup.
- Added regression tests proving a new combination adds exactly one history entry, and that a manually-expired entry is fully evicted (not just emptied) on the next sweep.

Distributed (Redis-backed) rate limiting across multiple instances remains tracked separately as forward work in issue #142 — this only fixes the in-process memory growth, which was a real bug independent of the distributed-vs-local question.
