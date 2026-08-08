import { SetMetadata } from '@nestjs/common';
import { TOOL_POLICIES_METADATA } from '../constants';
import type { ToolPolicy } from '../interfaces';

type PolicyConstructor = new (...args: unknown[]) => ToolPolicy;

/**
 * Attaches one or more policies to a @Tool method or an entire @ToolSet class.
 * Policies are evaluated in order before the tool handler is invoked.
 * Can be stacked with multiple @UsePolicies calls or by passing multiple policies.
 *
 * @example
 * @Tool({ description: 'Request a refund' })
 * @UsePolicies(RefundLimitPolicy, TenantBoundaryPolicy)
 * async refundOrder(@Param('orderId') orderId: string) {}
 */
export const UsePolicies = (...policies: PolicyConstructor[]): MethodDecorator & ClassDecorator =>
  SetMetadata(TOOL_POLICIES_METADATA, policies);
