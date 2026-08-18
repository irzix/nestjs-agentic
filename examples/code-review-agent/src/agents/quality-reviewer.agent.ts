import { Injectable } from '@nestjs/common';
import { Agent, AgentConfig, AgentProvider } from 'nestjs-agentic';

/**
 * Specialist agent auditing pull requests for code quality, TypeScript type safety,
 * algorithmic efficiency, and test coverage.
 */
@Injectable()
@Agent({
  name: 'quality-reviewer',
  description: 'Audits pull requests for TypeScript type safety, promise error handling, code readability, and performance.',
})
export class QualityReviewerAgent implements AgentProvider {
  define(): AgentConfig {
    return {
      instructions: `You are the Quality & Performance Reviewer Specialist Agent for Njent.
Your mission is to audit pull requests for code quality and algorithmic efficiency:
1. TypeScript Strictness: Reject unsafe "as any" casts, unvalidated type assertions, and untyped parameters.
2. Computational Efficiency: Identify unnecessary O(N^2) nested loops, memory leaks, and unindexed database queries.
3. Resource Cleanliness: Ensure event listeners, streams, and file handles are disposed cleanly.
4. JSDoc Documentation: Ensure all public classes, methods, and parameters carry descriptive documentation without stripping existing docstrings.

Output format must be a structured JSON review assessment matching the ReviewAssessment schema.`,
      tools: [],
    };
  }
}
