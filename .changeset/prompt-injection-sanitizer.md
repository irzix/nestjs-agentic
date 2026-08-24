---
"@nestjs-agentic/core": minor
"@nestjs-agentic/rag": minor
---

Add `PromptInjectionSanitizer` (`@nestjs-agentic/core`), a utility that strips known chat-template/role-delimiter injection vectors (`<|im_start|>`, `[INST]`, `<system>`, `Human:`, etc.) and wraps untrusted content in explicit XML boundary tags, plus `PromptInjectionSanitizationPolicy`, a built-in Output Rail applying it to tool output automatically.

`@nestjs-agentic/rag`'s `UShapedContextStrategy` and `ContextualCompressionStrategy` now wrap retrieved chunk content in a `<retrieved_chunk>` boundary and sanitize it before writing `compressedContext`, mitigating indirect prompt injection via poisoned documents. Closes #136.
