# 11 — Security & Guardrails Specification
> **How Njent guards against prompt injections, unauthorized access, and implements Tri-Rail Guardrails with Canary Tokens.**

---

## 📚 Academic & Research Foundations
* **Not What You've Signed Up For: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection** — *Greshake et al. (USENIX Security 2023)* ([arXiv:2302.12173](https://arxiv.org/abs/2302.12173)).
* **NeMo Guardrails: A Toolkit for Building Safe and Trustworthy LLM Applications** — *Rebedea et al., NVIDIA (2023)* ([arXiv:2310.10501](https://arxiv.org/abs/2310.10501)).

---

## 1. Conceptual Mapping in Njent

* **Indirect Prompt Injection:** Untrusted instructions hidden within PR diffs or comments attempting to override agent instructions.
* **NeMo Tri-Rail Guardrail Architecture:**
  1. *Input Rails:* HMAC signature verification + XML boundary isolation (`<untrusted_pr_diff>`) + Delimiter stripping.
  2. *Execution Rails:* Pre-tool deterministic policy interception (`ProtectedPathsPolicy`).
  3. *Output Rails:* Pre-egress secret scrubbing + Canary Token detection.

---

## 2. Technical Specification

### 2.1 Tri-Rail Security Architecture

```
Incoming Request
       │
       ▼
[Rail 1: Input Rail] ──> HMAC Check ➔ Collaborator RBAC ➔ XML Delimitation & Sanitization
       │
       ▼
[Rail 2: Execution Rail] ──> Deterministic Policy Boundary (@UsePolicies) ➔ ProtectedPaths Check
       │
       ▼
[Rail 3: Output Rail] ──> Regex Credential Scrubbing ➔ Canary Token Exfiltration Check
       │
       ▼
GitHub PR Comment Egress
```

### 2.2 Canary Token Leakage Detection (`CanaryGuardService`)
Injects an ephemeral, invisible canary token into the internal prompt context to verify the LLM is not regurgitating system prompts:
```typescript
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

@Injectable()
export class CanaryGuardService {
  generateCanary(): string {
    return `CANARY_${randomBytes(8).toString('hex')}`;
  }

  verifyOutputSafety(output: string, activeCanary: string): void {
    if (output.includes(activeCanary)) {
      throw new SecurityException('Output Rail Violation: Model attempted to leak internal system instructions.');
    }
  }
}
```

### 2.3 Protected Paths Security Policy (`ProtectedPathsPolicy`)
```typescript
@Injectable()
export class ProtectedPathsPolicy implements ToolPolicy {
  private readonly BLOCKED = ['.github/workflows/', 'package.json', 'LICENSE', 'SECURITY.md'];

  async evaluate(tool: ResolvedTool, args: any): Promise<PolicyDecision> {
    if (tool.name === 'create_fix_branch_and_commit') {
      const paths: string[] = args.fileModifications?.map((m: any) => m.path) || [];
      if (paths.some(path => this.BLOCKED.some(b => path.includes(b)))) {
        return { action: 'deny', reason: 'Automated modifications to CI workflows or security files are forbidden.' };
      }
    }
    return { action: 'allow' };
  }
}
```

---

## 3. Key Design Decisions

* **Canary Token Exfiltration Traps:** Detects prompt leakage and jailbreak extraction attempts instantly.
* **Deterministic Code Boundaries:** Never rely on system prompts to enforce security; use code policies (`ProtectedPathsPolicy`).
