import { applyDecorators, Injectable, SetMetadata } from '@nestjs/common';
import { TOOLSET_METADATA } from '../constants';

export interface ToolSetOptions {
  name: string;
  description?: string;
  tags?: string[];
}

/**
 * Marks a NestJS provider class as a container for related LLM tools.
 * Automatically applies @Injectable() so no separate annotation is needed.
 *
 * @example
 * @ToolSet({ name: 'order', tags: ['order', 'sales'] })
 * export class OrderTools {
 *   constructor(private orderService: OrderService) {}
 * }
 */
export const ToolSet = (options: ToolSetOptions) =>
  applyDecorators(
    Injectable(),
    SetMetadata(TOOLSET_METADATA, options),
  );
