---
'@nestjs-agentic/core': minor
---

Add RedisSessionStore and SessionStore behavioral contract test suite.

- adds `RedisSessionStore` implementing `SessionStore` with optional key prefixing and TTL expiration for session records
- adds `runSessionStoreContract` behavioral test suite verifying serializability, mutation isolation, multi-tenant separation, and round-trip operations
- updates `InMemorySessionStore` to store serialized snapshots rather than live references, matching persistent store behavior in development
