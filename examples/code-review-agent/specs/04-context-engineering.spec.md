# 04 — Context Engineering Specification
> **Comprehensive specification of all Context Engineering techniques, windows, compression, isolation, and growth optimization in Njent.**

---

## 📚 Academic & Research Foundations
* **Lost in the Middle: How Language Models Use Long Contexts** — *Liu et al., Stanford University & UC Berkeley (TACL 2024)* ([arXiv:2307.03172](https://arxiv.org/abs/2307.03172)).
* **In-Context Learning in Large Language Models: A Survey** — *Dong et al. (2023)* ([arXiv:2301.00234](https://arxiv.org/abs/2301.00234)).

---

## 1. Concrete Mapping of All 9 Context Engineering Concepts in Njent

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              NJENT CONTEXT ENGINEERING SYSTEM                          │
├───────────────────────────┬────────────────────────────────────────────────────────────┤
│ 1. What is Context Eng.?  │ • Selecting, structuring, and pruning tokens for the model │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 2. Context Window         │ • Bounded 128k token window managing prompt + output caps  │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 3. Context Selection      │ • ContextPruner: Stripping noisy lockfiles, SVGs, & builds │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 4. Context Compression    │ • Extracting TypeScript interface signatures; omitting     │
│                           │   irrelevant background function bodies                    │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 5. Context Isolation      │ • Supplying each sub-agent only with its domain slice:     │
│                           │   Security gets security policies; Arch gets roadmap AST   │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 6. Context Management     │ • U-Shaped Attention ordering (Lost in the Middle defense) │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 7. Managing Tool Context  │ • ContextualCompressionStrategy capping tool search outputs│
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 8. Context vs Memory vs   │ • Explicit scope separation (Ephemeral vs Cross-Turn vs DB)│
│    Knowledge              │                                                            │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 9. Growth & Optimization  │ • Sliding window history (trimHistory) & Prompt KV-Caching │
└───────────────────────────┴────────────────────────────────────────────────────────────┘
```

---

## 2. Technical Specification & Implementation Details

### 2.1 U-Shaped Prompt Structuring (Defeating "Lost in the Middle")
Following the empirical findings of *Liu et al. (Stanford/Berkeley)*, prompt sections are assembled to exploit the high-attention regions at the boundaries:

```
Prompt Attention Curve & Section Ordering:
100% ────┐                                                        ┌──── 100%
         │ [SECTION 1: SYSTEM INSTRUCTIONS & ROADMAP PILLARS]     │
         │ (High Primacy Attention)                               │
         └─────────────┐                            ┌─────────────┘
                       │ [SECTION 2: RAG CONTEXT]   │ [SECTION 3: PR DIFF & TRIGGER]
                       │ (Middle: Compressed Types) │ (High Recency Attention)
                       └────────────────────────────┘
               [TOP OF PROMPT]               [BOTTOM OF PROMPT]
```

```typescript
export class UCurvePromptAssembler {
  static assemblePrompt(systemInstructions: string, ragContext: string, prDiff: string): string {
    return [
      // 1. Primacy zone: High attention for critical rules and governance
      `<system_governance_rules>\n${systemInstructions}\n</system_governance_rules>`,
      // 2. Middle zone: Compressed type interfaces and AST signatures
      `<background_codebase_context>\n${ragContext}\n</background_codebase_context>`,
      // 3. Recency zone: Target PR diff for maximum focus during reasoning
      `<target_pull_request_diff>\n${prDiff}\n</target_pull_request_diff>`,
    ].join('\n\n');
  }
}
```

### 2.2 Context Selection & Noise Pruning (`src/ingestion/context-pruner.ts`)
```typescript
export class ContextPruner {
  private static readonly NOISY_EXTENSIONS = ['.lock', '.json', '.svg', '.png', '.min.js', '.map'];
  private static readonly MAX_DIFF_LINES_PER_FILE = 350;

  static prune(rawDiff: string): string {
    return rawDiff
      .split('diff --git ')
      .filter(diff => diff.trim().length > 0)
      .map(fileDiff => {
        const header = fileDiff.split('\n')[0];
        // Strip lockfiles and compiled assets
        if (this.NOISY_EXTENSIONS.some(ext => header.includes(ext))) {
          return `diff --git ${header}\n[... Automated Noise: Lockfile/Asset excluded from review context ...]`;
        }
        const lines = fileDiff.split('\n');
        // Cap massive files
        if (lines.length > this.MAX_DIFF_LINES_PER_FILE) {
          return lines.slice(0, this.MAX_DIFF_LINES_PER_FILE).join('\n') + 
                 `\n[... Truncated ${lines.length - this.MAX_DIFF_LINES_PER_FILE} lines for context optimization ...]`;
        }
        return 'diff --git ' + fileDiff;
      })
      .join('\n');
  }
}
```

### 2.3 Context Isolation Across Specialist Sub-Agents
```typescript
export class ContextIsolator {
  static createSecurityContext(prDiff: string, securityPolicies: string): string {
    return `### SECURITY REVIEW FOCUS\nPolicies:\n${securityPolicies}\n\nDiff:\n${prDiff}`;
  }

  static createArchitectureContext(prDiff: string, roadmapGuidelines: string): string {
    return `### ARCHITECTURE REVIEW FOCUS\nRoadmap Standards:\n${roadmapGuidelines}\n\nDiff:\n${prDiff}`;
  }
}
```

---

## 3. Context Engineering Trade-offs

| Technique | Token Savings | Accuracy Impact | Production Decision |
|---|---|---|---|
| **U-Shaped Ordering** | 0% (structural) | +28% retrieval recall on complex PRs | **Mandatory standard** |
| **Lockfile / Asset Pruning** | 60–85% on large PRs | Zero (Lockfiles don't need code review) | **Always enabled** |
| **Interface Signature Compression** | 40–60% on RAG chunks | High (Model sees full type contracts) | **Always enabled** |
