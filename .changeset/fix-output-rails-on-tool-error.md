---
'@nestjs-agentic/core': patch
---

Fix Output Rails (`ToolPolicy.evaluateOutput`) never running when a tool throws, so a thrown error's message (connection strings, upstream response bodies, API keys — exactly what `SecretRedactionPolicy`/`CanaryDetectionPolicy` are designed to catch) was reported to the model completely unsanitized.

- Added an optional `ResolvedTool.sanitizeErrorMessage(rawMessage, args)` hook. `LocalToolProvider` implements it by running the tool's attached policies' `evaluateOutput` against the error message (wrapped as `{ error: message }`), applying `sanitize`/`deny` the same way it does for a successful result's `data`.
- `AgentExecutor.toFailurePayload()` now calls this hook (when the tool provides one) before truncating the message to 500 characters. This is a fail-closed path: if the sanitizer itself throws (a broken or misconfigured policy), the raw message is replaced with a generic, non-sensitive placeholder rather than forwarded unsanitized — a broken policy must never be worse than no policy at all.
- Only applies to `toolErrorHandling: 'report'` (the default). In `'throw'` mode the original exception propagates unmodified, since the run ends before anything would be reported to the model.
- Providers without Output Rails (e.g. `McpToolProvider`) simply omit the hook; their error messages are unaffected.
- Added regression tests proving (1) a tool that throws an error containing a Postgres connection string with a password has that string redacted before it reaches the model, and (2) when the sanitizer itself throws, a generic fail-closed message is reported instead of the raw error.
