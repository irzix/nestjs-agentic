---
'@nestjs-agentic/core': minor
---

Add tool execution idempotency with IdempotencyStore, RedisIdempotencyStore, IdempotencyPolicy, and contract test suite.

- adds `IdempotencyStore` and `RedisIdempotencyStore` to cache and deduplicate side-effecting tool executions
- adds `IdempotencyPolicy` to validate and enforce presence of idempotency keys
- updates `LocalToolProvider` to automatically return cached tool results when an idempotency key is provided
- adds `runIdempotencyStoreContract` behavioral contract test suite
