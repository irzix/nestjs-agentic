import { applyDecorators, Injectable, SetMetadata } from '@nestjs/common';
import { AGENT_METADATA } from '../constants';
import type { ModelConfig } from '../interfaces';

export interface AgentDecoratorOptions {
  /** Unique identifier used in AgentRunner.run(name). */
  name: string;
  description: string;
  /** Overrides the defaultModel set in AgenticModule.forRoot(). */
  model?: ModelConfig;
}

/**
 * Marks a class as an agent provider.
 * Automatically applies @Injectable() so no separate annotation is needed.
 * The class must implement AgentProvider.
 *
 * @example
 * @Agent({
 *   name: 'customer-support',
 *   description: 'Handles order lookup and refund inquiries',
 * })
 * export class SupportAgent implements AgentProvider {
 *   define(): AgentConfig { ... }
 * }
 */
export const Agent = (options: AgentDecoratorOptions) =>
  applyDecorators(
    Injectable(),
    SetMetadata(AGENT_METADATA, options),
  );
