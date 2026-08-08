import { TOOL_PARAMS_METADATA } from '../constants';
import type { ToolParamSchema } from '../interfaces';

export interface ParamOptions {
  description?: string;
  type?: ToolParamSchema['type'];
  required?: boolean;
}

export interface ParamMetadata {
  index: number;
  name: string;
  options: ParamOptions;
}

/**
 * Declares a parameter on a @Tool method and exposes it to the LLM
 * as part of the tool's input schema.
 *
 * @example
 * @Tool({ description: 'Refund an order' })
 * async refundOrder(
 *   @Param('orderId', { description: 'The order ID' }) orderId: string,
 *   @Param('amount', { type: 'number' }) amount: number,
 * ) {}
 */
export const Param = (name: string, options: ParamOptions = {}): ParameterDecorator =>
  (target, propertyKey, parameterIndex) => {
    const existing: ParamMetadata[] =
      Reflect.getMetadata(TOOL_PARAMS_METADATA, target, propertyKey as string) ?? [];

    existing.push({ index: parameterIndex, name, options });

    Reflect.defineMetadata(TOOL_PARAMS_METADATA, existing, target, propertyKey as string);
  };
