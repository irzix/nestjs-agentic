---
"nestjs-agentic": patch
"@nestjs-agentic/core": patch
"@nestjs-agentic/memory": patch
"@nestjs-agentic/rag": patch
"@nestjs-agentic/orchestration": patch
"@nestjs-agentic/evaluation": patch
"@nestjs-agentic/openai": patch
"@nestjs-agentic/mcp": patch
---

Support NestJS 12 and tighten what gets published.

- Peer dependencies on `@nestjs/common` and `@nestjs/core` now accept `^12.0.0`, so installing into a NestJS 12 app no longer fails with `ERESOLVE`. Every package's test suite passes against NestJS 11.2 and 12.1, and CI now checks both. NestJS 12 is ESM only; with these CommonJS packages it needs Node 20.19+ or 22.12+.
- Internal `*` ranges (`@nestjs-agentic/memory` in `rag`'s dependencies, and the `@nestjs-agentic/core` / `nestjs-agentic` peers of `memory`, `rag` and `openai`) are now `^1.4.0`, so a future major of a sibling package is never pulled in silently.
- Compiled tests are written to `test-dist/` instead of `dist/test/`, so they are no longer published. `@nestjs-agentic/core` drops from 712 files (3.4 MB) to about 315 files (1.4 MB) unpacked.
