<p align="center">
  <img src="https://raw.githubusercontent.com/irzix/nestjs-agentic/main/docs/assets/banner.jpeg" alt="nestjs-agentic banner" width="100%" />
</p>

<h1 align="center">@nestjs-agentic/adk</h1>

<p align="center">
  <b>Experimental synthetic runtime prototype published under the @nestjs-agentic/adk package name</b>
</p>

## Status and Current Scope

**Experimental:** this package is available for evaluation of the runtime boundary and governed `ResolvedTool` closures. Despite its package name, it does not currently integrate with provider-native Google ADK APIs and is not a production model adapter.

The current implementation:

- does not create or run a provider-native Google ADK agent;
- does not make a Gemini or other model call;
- does not derive tool calls or arguments from the prompt;
- invokes resolved tools in registration order with an empty argument object, stopping early only when a tool returns `pending_approval`;
- returns a synthetic completion string; and
- relies on the core fallback for `runStream()` because it has no native stream implementation.

Because empty arguments can reach application methods after policy evaluation, do not use this adapter with tools that perform side effects. Use `MockRuntimeAdapter` for deterministic governance tests while the independent runtime and provider contracts are developed.

## Installation

```bash
npm install nestjs-agentic @nestjs-agentic/adk
```

## Evaluation Registration

```typescript
import { Module } from '@nestjs/common';
import { AgenticModule, RUNTIME_ADAPTER } from 'nestjs-agentic';
import { AdkRuntimeAdapter } from '@nestjs-agentic/adk';

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'google', model: 'gemini-2.0-flash' },
    }),
  ],
  providers: [
    { provide: RUNTIME_ADAPTER, useClass: AdkRuntimeAdapter },
  ],
})
export class AppModule {}
```

Setting `GEMINI_API_KEY` does not cause the current adapter to make a provider request. The option exists in the package surface but is not consumed by a native model call today.

See the [product roadmap](https://github.com/irzix/nestjs-agentic/blob/main/docs/ROADMAP.md) for the planned independent runtime and adapter contract work.

## License

MIT © [irzix](https://github.com/irzix)
