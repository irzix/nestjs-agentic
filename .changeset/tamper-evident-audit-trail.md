---
"@nestjs-agentic/core": minor
---

Add a tamper-evident audit trail. `HashChainAuditSink` wraps an audit destination and binds every event to its predecessor (`hash_n = H(hash_{n-1} || canonical(event_n))`), with `verifyAuditChain` detecting altered, deleted, reordered, and re-linked entries. Events are canonically serialized (sorted keys, ISO dates) so equal content always hashes equally; chaining is serialized so concurrent records still verify, and a chain can be resumed across restarts. `PostgresAuditSink` ships as a real, append-only `AuditSink` that also implements `ChainedAuditEntrySink`, persisting the chain columns and exposing `head()`/`readChain()` for resumption and verification.

Part of #139.
