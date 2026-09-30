---
"@nestjs-agentic/memory": minor
---

Fix tenant isolation in `ExperienceLearner`.

**Behavior change:** a lesson recorded with a `tenantId` is now recalled only when the same `tenantId` is passed to `recallLessons` / `buildGuidancePrompt`. Code that recorded with a tenant and recalled without one was reading other tenants' lessons through the fallback cache; pass the tenant when recalling. The code-review example is updated to scope lessons per repository.

- The in-process fallback cache was keyed by trigger only, so a lesson recorded for one tenant could be recalled for another whenever the memory store returned nothing. It is now keyed by tenant scope and trigger.
- `AgentTrajectory` accepts an optional `tenantId`. `critiqueTrajectory` stores lessons under it, so one session's lessons reach the tenant's later sessions. Without it, lessons stay scoped to `sessionId` as before.
- The fallback cache is bounded (`maxFallbackRecords`, default 1000, `0` disables it) and evicts the least recently written lessons first.
- Raw tool error text is no longer copied into lessons, which are later injected into prompts as guidance. It stays in the critique, truncated to 500 characters.
- `buildGuidancePrompt` renders each lesson as a single line without control characters, capped at 300 characters.
