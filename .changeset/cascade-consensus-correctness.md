---
"@nestjs-agentic/core": patch
"@nestjs-agentic/orchestration": patch
---

Emit the accepted cascade response without generating it twice, preserving cumulative usage and tier configuration. Tool-call syntax no longer receives a high default confidence score. Consensus now requires an explicit answer evaluator instead of comparing confidence values; unknown agreement cannot terminate a debate early. Cascade streams are buffered until acceptance.
