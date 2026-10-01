---
"@nestjs-agentic/core": minor
---

Redact errors before they reach observers.

Observers usually forward events to external telemetry, and provider SDK errors routinely carry request headers, API keys, and prompt content. `ObserverNotifier` now scrubs every error-carrying field before dispatch: `AgentErrorEvent.error`, `ModelRetryEvent.error`, `CircuitBreakerEvent.reason`, and the `error` text of failed tool results in `ToolResultEvent` and `AgentEndEvent`.

- **Behavior change:** by default observers now receive a `RedactedError` instead of the original error. It keeps `name`, a credential-masked message capped at 500 characters, numeric `status`/`statusCode`, a short `code`, stack frames, and a redacted `cause` chain (3 links deep). Request config, headers, response bodies, and every other property are dropped. The error thrown to the caller of `run()` is unchanged.
- Configure it with `observability.errorRedaction` on `AgenticModuleOptions`: pass `createErrorRedactor({ maxMessageLength, maxCauseDepth, patterns, mask })`, any `(error: unknown) => Error` (optionally with `redactText` for free text), or `'none'` to restore raw errors. Any other value is rejected. `ObserverNotifier` accepts the same setting as `errorRedaction`.
- New exports: `ErrorRedactor`, `ObservabilityOptions`, `ErrorRedactorOptions`, `RedactedError`, `createErrorRedactor`, `defaultErrorRedactor`.
