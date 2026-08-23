---
"@nestjs-agentic/core": minor
---

Add `AgenticModuleOptions.defaultPolicies`, a module-wide policy chain applied to every discovered tool that doesn't opt out via the new `@ExemptFromDefaultPolicies()` decorator — enabling deny-by-default governance instead of purely per-tool opt-in via `@UsePolicies`. Default policies evaluate before class-level and method-level `@UsePolicies`. Closes #135.
