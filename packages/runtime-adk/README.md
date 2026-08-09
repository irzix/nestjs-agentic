<p align="center">
  <img src="https://raw.githubusercontent.com/irzix/nestjs-agentic/main/docs/assets/banner.jpeg" alt="nestjs-agentic banner" width="100%" />
</p>

<h1 align="center">@nestjs-agentic/adk</h1>

<p align="center">
  <b>Google ADK & Gemini Runtime Adapter for nestjs-agentic</b>
</p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-v10%2B-E0234E?style=flat&logo=nestjs&logoColor=white" alt="NestJS Compatible" /></a>
  <a href="https://www.npmjs.com/package/@nestjs-agentic/adk"><img src="https://img.shields.io/npm/v/@nestjs-agentic/adk.svg?color=E0234E" alt="NPM Version" /></a>
  <a href="https://github.com/irzix/nestjs-agentic/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@nestjs-agentic/adk.svg?color=blue" alt="License" /></a>
</p>

---

## Overview

`@nestjs-agentic/adk` connects `nestjs-agentic` tool definitions and policy guardrails to Google's **Agent Development Kit (ADK)** and Gemini LLM models.

## Installation

```bash
npm install nestjs-agentic @nestjs-agentic/adk
```

## Quick Start

Register `AdkRuntimeAdapter` as the `RUNTIME_ADAPTER` provider in your root application module:

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

Configure your Gemini API key in your environment:

```bash
export GEMINI_API_KEY="your-gemini-api-key"
```

## License

MIT © [irzix](https://github.com/irzix)
