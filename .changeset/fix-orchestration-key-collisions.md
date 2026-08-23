---
'@nestjs-agentic/orchestration': patch
---

Fix the same delimiter-collision class of bug (see the `@nestjs-agentic/core` idempotency-scoping fix) in `RefinementLoopRunner`'s checkpoint/lock keys, `SopRunner`'s checkpoint key, and `SubAgentDelegator`'s sub-agent session id — all previously built via plain `:`-delimited string concatenation of tenant id, session id, and/or agent name, any of which could contain `:` and collide two different scopes onto the same key.

All four now use `@nestjs-agentic/core`'s `scopeKey(...)` utility.
