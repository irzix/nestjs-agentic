# @nestjs-agentic/jev

[Jev](https://typesafe.ai) (TypeSafe System One) decisions for [nestjs-agentic](https://github.com/irzix/nestjs-agentic) governance.

Jev answers typed questions with calibrated probabilities. This package turns those probabilities into the framework's governance outcomes:

- **`JevActionGate`**: a tool policy that **allows** a call when Jev is confident it is safe, sends it to **human review** in the uncertain band (optionally to several approvers), and **denies** it when Jev judges it unsafe.
- **`JevOutputGate`**: an output rail that withholds tool output, such as a prompt injection in a fetched page or email, before the model sees it.
- **`jevFaithfulnessJudge`, `jevTaskJudge`**: judges for `@nestjs-agentic/evaluation`'s `FaithfulnessMetric` and `LLMAsAJudgeMetric`.

## Installation

```bash
npm install @nestjs-agentic/jev @typesafe-ai/sdk
```

Set `TYPESAFE_API_KEY`. Requires Node.js 20+.

## Usage

```typescript
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { JevActionGate, JevModule } from '@nestjs-agentic/jev';

export const RefundGate = JevActionGate({
  name: 'RefundGate',
  question: 'Is this refund routine enough to issue without a supervisor?',
  allowAt: 0.95,                                // p(safe) >= 0.95: runs
  denyBelow: 0.1,                               // p(safe) < 0.1: refused
  requiredApprovals: (p) => (p < 0.5 ? 2 : 1),  // in between: 1 or 2 approvers
});

@Module({
  imports: [
    JevModule.forRoot({ client: new TypeSafeClient() }),
    AgenticModule.forRoot({ defaultModel: { provider: 'openai', model: 'gpt-4o' } }),
    AgenticModule.forFeature({ agents: [SupportAgent], toolSets: [BillingTools], policies: [RefundGate] }),
  ],
})
export class AppModule {}

// On the tool:
@UsePolicies(RefundGate)
```

By default Jev sees `{ tool, arguments }`, which is sent to the TypeSafe API. Use `describe` to control exactly what leaves your system. When Jev is unreachable or too slow, calls go to human review by default (`onError`), and a circuit breaker stops waiting on Jev once it has failed repeatedly. `requiredApprovals` above 1 needs `@nestjs-agentic/core` 1.6.0 or later.

See the [full documentation](https://github.com/irzix/nestjs-agentic/tree/main/apps/landing/content/docs/jev/index.mdx).

## License

[MIT](https://github.com/irzix/nestjs-agentic/blob/main/LICENSE)
