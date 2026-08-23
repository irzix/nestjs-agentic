import { SetMetadata } from '@nestjs/common';
import { EXEMPT_DEFAULT_POLICIES_METADATA } from '../constants';

/**
 * Opts a `@Tool` method or an entire `@ToolSet` class out of
 * `AgenticModuleOptions.defaultPolicies`. The exemption is itself
 * discoverable metadata (not a silent bypass) and every use is recorded in
 * `DiscoveredTool.exemptFromDefaultPolicies`, so it's auditable by tooling
 * that inspects a module's tool set.
 *
 * Policies from `@UsePolicies` still apply as normal — this only removes the
 * module-wide default chain for the annotated tool/class.
 *
 * @example
 * ```typescript
 * @Tool({ description: 'Read-only lookup, exempt from write-oriented defaults' })
 * @ExemptFromDefaultPolicies()
 * async getOrderStatus(@Param('orderId') orderId: string) {}
 * ```
 */
export const ExemptFromDefaultPolicies = (): MethodDecorator & ClassDecorator =>
  SetMetadata(EXEMPT_DEFAULT_POLICIES_METADATA, true);
