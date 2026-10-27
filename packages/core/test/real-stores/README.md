# Real database / process recovery tests

Run against dedicated disposable Redis 6.2+ and PostgreSQL databases:

```sh
REDIS_URL=redis://localhost:6379/15 POSTGRES_URL=postgres://agentic:agentic_test@localhost:5432/agentic_test npm run test:real-stores --workspace=@nestjs-agentic/core
```

The dedicated CI workflow provisions Redis 7 and PostgreSQL 16. Missing URLs fail
explicitly; the ordinary unit test command does not require database servers.

For each backend this suite starts independent Node processes, kills the producer
with SIGKILL, rejects cross-tenant approval, races two approvers, and verifies one
persisted side effect and a resumed model response. It also kills a worker after
its tool round has been checkpointed and verifies recovery does not replay it.
The model is deterministic; persistence and process termination are real.

Tests leave unique session/checkpoint records in the supplied databases. Use
throwaway databases, not production. Child processes and temporary effect ledgers
are cleaned up even on failure.

## Limits

These tests cover acknowledged approval checkpoints and completed round checkpoints.
They do not prove exactly-once arbitrary external side effects. A crash between an
external side effect and its durable result/checkpoint needs application-level
idempotency or a transaction/outbox; an atomic approval claim alone cannot close
that gap. They also do not simulate database failover or network partitions.
