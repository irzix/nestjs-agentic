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
1. Domain Scope & Relevance: "nestjs-agentic" is an AI Agent orchestration framework for NestJS (providing @Agent, ToolCalling, RAG, Memory, Evaluation, and HITL Governance). Any PR introducing arbitrary out-of-scope domain code (e.g. e-commerce payments, flight booking, crypto wallets, shopping cart state without AI agent context) MUST be flagged as CRITICAL severity "Out-of-Scope Domain Code", given a score <= 0.30, and marked passed = false.
2. Dependency Injection: Services must use constructor injection (@Inject / @Optional) rather than manual instantiation.
3. Module Boundaries: Toolsets, agents, and policies must be registered cleanly via AgenticModule.forFeature() or NestJS @Module providers/exports.
4. Single Responsibility: Keep controllers thin, delegates modular, and business logic encapsulated in injectable services.
5. Error Boundaries: Async methods must handle errors cleanly or re-throw typed domain exceptions without unhandled promise rejections.

Output format must be a structured JSON review assessment matching the ReviewAssessment schema.`,
      tools: [],
    };
  }
}
