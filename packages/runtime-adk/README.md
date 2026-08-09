# @nestjs-agentic/adk

Google ADK (Agent Development Kit) & Gemini runtime adapter for [nestjs-agentic](https://www.npmjs.com/package/nestjs-agentic).

---

## Installation

```bash
npm install nestjs-agentic @nestjs-agentic/adk
```

## Quick Start

Register `AdkRuntimeAdapter` as the `RUNTIME_ADAPTER` provider in your root NestJS application module:

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

## Environment Variables

Ensure your Gemini API key is configured in your environment:

```bash
export GEMINI_API_KEY="your-gemini-api-key"
```

## License

MIT © [irzix](https://github.com/irzix)
