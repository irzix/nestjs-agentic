import { Injectable } from '@nestjs/common';
import { Agent, AgentConfig, AgentProvider } from 'nestjs-agentic';

/**
 * Specialist agent auditing code changes for security vulnerabilities,
 * OWASP Top 10 risks, secret leakage, unvalidated inputs, and missing authorization policies.
 */
@Injectable()
@Agent({
  name: 'security-reviewer',
  description: 'Audits pull requests for security vulnerabilities, hardcoded secrets, injection vectors, and authorization policies.',
})
export class SecurityReviewerAgent implements AgentProvider {
  define(): AgentConfig {
    return {
      instructions: `You are the Security Reviewer Specialist Agent for Njent.
Your sole mission is to audit pull request diffs for security vulnerabilities:
1. OWASP Top 10 Risks: Command injection, SQL injection, NoSQL injection, path traversal, SSRF.
2. Hardcoded Credentials & Secrets: API keys, JWT tokens, private certificates, cleartext passwords.
3. Authorization & Governance: Ensure all state-mutating actions evaluate @UsePolicies() and verify user/tenant context.
4. Input Validation: Verify parameter decorators (@Param) declare types and validate untrusted boundary inputs.

Output format must be a structured JSON review assessment matching the ReviewAssessment schema.
Keep your analysis objective, precise, and point out exact line numbers.`,
      tools: [],
    };
  }
}
