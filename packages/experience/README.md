# @nestjs-agentic/experience

Experience learning, trajectory reflection (Reflexion pattern), and self-correction engine for **nestjs-agentic**.

---

## Installation

```bash
npm install @nestjs-agentic/experience @nestjs-agentic/memory nestjs-agentic
```

---

## Features

1. **Trajectory Reflection Engine (`ReflectionEngine`)**:
   - Analyzes execution trajectories, critiques tool failures (*Reflexion*, Shinn et al., MIT, 2023), and extracts actionable self-correction rules.
   - Automatically computes **Cognitive Importance Ratings** ($0.1$ to $1.0$) based on failure severity (e.g., security/authorization violation: $0.95$, financial ledger error: $0.90$, package manager: $0.70$, general timeout: $0.60$).
2. **Experience Learner (`ExperienceLearner`)**:
   - Records learned trajectory rules and injects prompt guidance into agent execution contexts.
   - Integrates seamlessly with `@nestjs-agentic/memory` (`GenerativeMemoryStore`, `EpisodicMemory`) to retain and retrieve lessons using Stanford Tri-Factor time-decayed scoring.

---

## Quick Start

```typescript
import { ExperienceLearner } from '@nestjs-agentic/experience';
import { GenerativeMemoryStore } from '@nestjs-agentic/memory';

const memory = new GenerativeMemoryStore();
const learner = new ExperienceLearner({ memoryStore: memory });

// Critique a failed trajectory and extract self-correcting lessons
const reflection = await learner.critiqueTrajectory({
  sessionId: 'sess_101',
  agentName: 'build-agent',
  goal: 'Package Installation',
  success: false,
  steps: [
    { stepIndex: 1, toolName: 'npmInstall', error: 'npm ERR! lockfile mismatch, use pnpm add instead' },
  ],
});

console.log(reflection.lessonsLearned);
// => ["Use \"pnpm\" package manager instead of \"npm\" for this project."]
console.log(reflection.importance);
// => 0.70

// Generate dynamic prompt guidance for future runs
const guidance = await learner.buildGuidancePrompt('Package Installation', 'sess_101');
```

---

## License

[MIT](LICENSE) © [irzix](https://github.com/irzix)
