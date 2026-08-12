# @nestjs-agentic/openai

OpenAI `ModelAdapter` for the NestJS-native runtime for governed AI agents, built on the official [`openai`](https://www.npmjs.com/package/openai) SDK.

It drives the built-in `AgentExecutor` loop, so tool execution, policy evaluation, argument validation, execution budgets, and streaming stay in the framework. This package only talks to the provider.

Because it speaks the Chat Completions API, it also works with compatible endpoints such as Azure OpenAI, Ollama, vLLM, Groq, Together, OpenRouter, and LM Studio.

## Installation

```bash
npm install @nestjs-agentic/openai nestjs-agentic openai
```

`openai` is a peer dependency, so your application controls the SDK version. Requires Node 18 or newer.

## Usage

```typescript
import { Module } from '@nestjs/common';
import { AgenticModule } from 'nestjs-agentic';
import { OpenAiModelAdapter } from '@nestjs-agentic/openai';

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
      modelAdapter: new OpenAiModelAdapter({
        apiKey: process.env.OPENAI_API_KEY,
      }),
      limits: { maxIterations: 6, timeoutMs: 60_000 },
    }),
    AgenticModule.forFeature({
      agents: [SupportAgent],
      toolSets: [OrderTools],
      policies: [RefundLimitPolicy],
    }),
  ],
})
export class AppModule {}
```

Registering the adapter through `forRoot()` is the recommended path, because `AgentExecutor` is instantiated inside `AgenticModule` and resolves the model adapter from that context.

Tool calls, policy decisions, and approvals continue to flow through `AgentRunner`:

```typescript
const result = await runner.run('support', {
  sessionId: 'sess_1',
  message: 'Refund $600 for order #42',
  context: { userId: 'usr_1', tenantId: 'acme' },
  limits: { maxToolCalls: 8 },
  signal: abortController.signal,
});
```

## Options

| Option | Purpose |
| --- | --- |
| `apiKey` | API key. Falls back to the SDK default of `OPENAI_API_KEY`. |
| `baseUrl` | Base URL of any Chat Completions compatible API. |
| `headers` | Extra headers merged into every request. |
| `timeoutMs` | Per-request timeout applied by the SDK. |
| `maxRetries` | SDK retries for transient failures such as 429 and 5xx. Default `2`. |
| `temperature`, `topP` | Sampling controls forwarded to the provider. |
| `maxTokens` | Token cap for classic chat models. |
| `maxCompletionTokens` | Token cap for reasoning models, which reject `max_tokens`. Takes precedence. |
| `includeStreamUsage` | Request usage in the final streaming chunk. Default `true`. |
| `extraBody` | Extra body fields merged into every payload. |
| `client` | Pre-configured `OpenAI` instance. Connection options above are then ignored. |
| `clientOptions` | Additional SDK client options merged when constructing the client. |

## Compatible Endpoints

Point `baseUrl` at any server implementing Chat Completions. Most local servers ignore the key but the SDK still requires a non-empty value.

```typescript
// Ollama
new OpenAiModelAdapter({
  apiKey: 'not-needed',
  baseUrl: 'http://localhost:11434/v1',
});

// vLLM
new OpenAiModelAdapter({
  apiKey: 'not-needed',
  baseUrl: 'http://localhost:8000/v1',
});

// OpenRouter
new OpenAiModelAdapter({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseUrl: 'https://openrouter.ai/api/v1',
});
```

If a server rejects `stream_options`, set `includeStreamUsage: false`.

## Azure OpenAI

Azure uses a different authentication and routing scheme, so supply a configured client:

```typescript
import { AzureOpenAI } from 'openai';
import { OpenAiModelAdapter } from '@nestjs-agentic/openai';

const adapter = new OpenAiModelAdapter({
  client: new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiVersion: '2024-10-21',
  }),
});
```

## Reasoning Models

Reasoning models reject `max_tokens`. Use `maxCompletionTokens`, and avoid `temperature` and `topP` where the model does not support them:

```typescript
new OpenAiModelAdapter({
  apiKey: process.env.OPENAI_API_KEY,
  maxCompletionTokens: 8192,
});
```

## Behavior Notes

- **Tool schemas.** Declared `@Param` metadata becomes a JSON Schema function definition. Only parameters marked `required` are listed as required. Arrays are emitted with an unconstrained `items` schema, since the framework parameter schema does not describe element types.
- **Malformed tool arguments.** The API returns arguments as a JSON string. If a model emits invalid JSON, the adapter yields an empty argument object so the executor's validation reports the problem back to the model rather than failing the turn.
- **Streaming.** Content deltas are emitted as `token` chunks and fragmented tool-call deltas are reassembled before the final `response` chunk. `AgentRunner.runStream()` then surfaces framework `token`, `tool_start`, `tool_result`, `approval_required`, and `complete` events.
- **Errors.** SDK failures are wrapped in `OpenAiModelError` carrying `status`, `code`, and the original error as `cause`. Cancellation is reported with code `aborted` and SDK timeouts with code `timeout`. Request headers are never included in messages, so API keys do not reach logs.
- **Custom tool calls.** Only function tool calls are mapped, because the framework exposes function tools exclusively.

## Escape Hatch

`getClient()` returns the underlying SDK client for provider features outside this contract, such as embeddings or the Responses API:

```typescript
const embeddings = await adapter.getClient().embeddings.create({
  model: 'text-embedding-3-small',
  input: 'governance policy',
});
```

## Testing

Inject a `fetch` implementation through `clientOptions` to run deterministic tests without network access:

```typescript
const adapter = new OpenAiModelAdapter({
  apiKey: 'sk-test',
  maxRetries: 0,
  clientOptions: { fetch: stubFetch },
});
```

For agent, tool, and policy tests that do not need provider behavior at all, use `MockModelAdapter` from `nestjs-agentic`.

## License

[MIT](https://github.com/irzix/nestjs-agentic/blob/main/LICENSE) © [irzix](https://github.com/irzix)
