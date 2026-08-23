---
'@nestjs-agentic/core': patch
---

Fix Output Rails (`ToolPolicy.evaluateOutput`) never running when a tool throws, so a thrown error's message (connection strings, upstream response bodies, API keys — exactly what `SecretRedactionPolicy`/`CanaryDetectionPolicy` are designed to catch) was reported to the model completely unsanitized.

- Added an optional `ResolvedTool.sanitizeErrorMessage(rawMessage, args)` hook. `LocalToolProvider` implements it by running the tool's attached policies' `evaluateOutput` against the error message (wrapped as `{ error: message }`), applying `sanitize`/`deny` the same way it does for a successful result's `data`.
- `AgentExecutor.toFailurePayload()` now calls this hook (when the tool provides one) before truncating the message to 500 characters. A sanitizer that itself throws falls back to the raw message rather than swallowing the tool failure.
- Only applies to `toolErrorHandling: 'report'` (the default). In `'throw'` mode the original exception propagates unmodified, since the run ends before anything would be reported to the model.
- Providers without Output Rails (e.g. `McpToolProvider`) simply omit the hook; their error messages are unaffected.
- Added a regression test proving a tool that throws an error containing a Postgres connection string with a password has that string redacted before it reaches the model.
