import { SetMetadata } from '@nestjs/common';
import { TOOL_POLICIES_METADATA } from '../constants';
import type { ToolPolicy } from '../interfaces';

export type PolicyInput = (new (...args: unknown[]) => ToolPolicy) | ToolPolicy;

/**
 * Attaches one or more governance policies to a `@Tool` method or an entire `@ToolSet` class.
 * Policies are evaluated in order before the tool handler is invoked.
 *
 * @example
 * ```typescript
 * @Tool({ description: 'Request a financial transfer' })
 * @UsePolicies(new CostLimitPolicy({ autoAllowLimit: 500 }), TenantBoundaryPolicy)
 * async transferFunds(@Param('amount') amount: number) {}
 * ```
 */
export const UsePolicies = (...policies: PolicyInput[]): MethodDecorator & ClassDecorator =>
  SetMetadata(TOOL_POLICIES_METADATA, policies);
