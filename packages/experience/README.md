# @nestjs-agentic/experience

Experience learning, trajectory reflection (Reflexion pattern), and self-correction engine for **nestjs-agentic**.

---

## Installation

```bash
npm install @nestjs-agentic/experience @nestjs-agentic/memory nestjs-agentic
```

---

## Features

1. **Trajectory Reflection Engine**: Analyzes agent execution trajectories, critiques tool failures, and extracts actionable lessons learned.
2. **Experience Learner**: Records learned trajectory rules and injects prompt guidance into agent execution contexts.
3. **Seamless Memory Integration**: Integrates directly with `@nestjs-agentic/memory` to persist learned rules across session threads.

---

## Quick Start

```typescript
import { ExperienceLearner } from '@nestjs-agentic/experience';
import { ShortTermMemory } from '@nestjs-agentic/memory';

const memory = new ShortTermMemory();
const learner = new ExperienceLearner({ memoryStore: memory });

// Reflect on a failed execution trajectory
const reflection = await learner.reflect({
  sessionId: 'sess_101',
  agentName: 'build-agent',
  goal: 'Package Installation',
  success: false,
  steps: [
    { stepIndex: 1, toolName: 'npmInstall', error: 'npm ERR! Use pnpm add instead' },
  ],
});

console.log(reflection.lessonsLearned);
// => ["Use \"pnpm\" package manager instead of \"npm\" for this project."]

// Retrieve guidance for future runs
const guidance = await learner.getPromptGuidance('Package Installation');
```

---

## License

[MIT](LICENSE) © [irzix](https://github.com/irzix)
