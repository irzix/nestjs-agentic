import { TOOL_PARAMS_METADATA } from '../constants';

export const CONTEXT_PARAM_KEY = '__context__';

/**
 * Injects the current AgentContext into a @Tool method parameter.
 * The parameter is NOT exposed to the LLM — it is injected internally
 * by LocalToolProvider at execution time.
 *
 * @example
 * @Tool({ description: 'Look up customer order details' })
 * async getOrder(
 *   @Param('orderId') orderId: string,
 *   @Context() ctx: AgentContext,
 * ) {
 *   return this.orderService.findById(orderId, ctx.security.userId);
 * }
 */
export const Context = (): ParameterDecorator =>
  (target, propertyKey, parameterIndex) => {
    Reflect.defineMetadata(
      CONTEXT_PARAM_KEY,
      parameterIndex,
      target,
      propertyKey as string,
    );
  };
