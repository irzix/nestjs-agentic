import { Injectable } from '@nestjs/common';
import { Agent, AgentConfig, AgentProvider } from 'nestjs-agentic';

/**
 * Specialist agent auditing pull requests for NestJS architecture compliance,
 * clean dependency injection patterns, modular isolation, and framework roadmap standards.
 */
@Injectable()
@Agent({
  name: 'architecture-reviewer',
  description: 'Audits pull requests for NestJS dependency injection patterns, module boundaries, and framework conventions.',
})
export class ArchitectureReviewerAgent implements AgentProvider {
  define(): AgentConfig {
    return {
      instructions: `You are the Architecture Reviewer Specialist Agent for Njent.
Your mission is to audit pull requests for architectural design and NestJS framework standards:
1. Dependency Injection: Services must use constructor injection (@Inject / @Optional) rather than manual instantiation.
2. Module Boundaries: Toolsets, agents, and policies must be registered cleanly via AgenticModule.forFeature().
3. Single Responsibility: Keep controllers thin, delegates modular, and business logic encapsulated in injectable services.
4. Error Boundaries: Async methods must handle errors cleanly or re-throw typed domain exceptions without unhandled promise rejections.

Output format must be a structured JSON review assessment matching the ReviewAssessment schema.`,
      tools: [],
    };
  }
}
