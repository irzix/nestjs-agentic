---
'@nestjs-agentic/core': minor
---

Publish a behavioral contract-test suite for `ApprovalStore`, and hold both built-in stores to it.

`RedisApprovalStore` is the durable store applications are told to use in production, but it had no tests at all — including the `GETDEL` claim path and the TTL derivation that the exactly-once and expiry guarantees depend on. There was also no way for a third-party store to prove it behaves like the runtime expects.

- adds `runApprovalStoreContract()`, exported from the package alongside `runModelAdapterContract()`, covering round-trip fidelity, `Date` revival, checkpoint persistence, returned-record isolation, `save()` as update, `delete()`, single-use `claim()`, and `claim()` atomicity under concurrent callers
- `supportsAtomicClaim: false` skips the concurrency assertions for a store that cannot claim atomically — such as `RedisApprovalStore` behind a client without `GETDEL` — so the gap is counted as skipped rather than silently passing
- both built-in stores and the `GETDEL` fallback path now run against the suite, plus `RedisApprovalStore`-specific coverage for key prefixing, TTL derived from `expiresAt` and the grace floor, `ttlSeconds` precedence, command selection, and the stored JSON payload shape

The contract surfaced a real divergence between the two stores: `InMemoryApprovalStore` handed out live object references, so a caller mutating a record it read would silently corrupt stored state, and `createdAt` was whatever object was passed in rather than a revived `Date`. It now keeps serialized snapshots, matching what a persistent store must do. Code that works against the development store therefore behaves the same behind Redis, instead of failing only in production.

No breaking changes to the `ApprovalStore` interface. Applications that read an approval, mutate the returned object, and expect the store to observe that mutation were relying on unintended behavior and must now `save()` explicitly.
