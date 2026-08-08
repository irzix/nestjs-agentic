import { SetMetadata } from '@nestjs/common';
import { TOOL_METADATA } from '../constants';

export interface ToolOptions {
  description: string;
  /**
   * Name exposed to the LLM in the function calling schema.
   * Defaults to the decorated method name if not provided.
   */
  name?: string;
}

/**
 * Marks a method inside a @ToolSet class as callable by an LLM.
 *
 * @example
 * @Tool({ description: 'Look up customer order details' })
 * async getOrder(@Param('orderId') orderId: string) {}
 */
export const Tool = (options: ToolOptions): MethodDecorator =>
  SetMetadata(TOOL_METADATA, options);
