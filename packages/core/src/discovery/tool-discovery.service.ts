import { Injectable } from '@nestjs/common';
import {
  TOOLSET_METADATA,
  TOOL_METADATA,
  TOOL_PARAMS_METADATA,
  TOOL_POLICIES_METADATA,
} from '../constants';
import { CONTEXT_PARAM_KEY } from '../decorators/context.decorator';
import type { ToolSetOptions } from '../decorators/tool-set.decorator';
import type { ToolOptions } from '../decorators/tool.decorator';
import type { ParamMetadata } from '../decorators/param.decorator';
import type { ToolParamSchema, ToolPolicy } from '../interfaces';

type PolicyConstructor = new (...args: unknown[]) => ToolPolicy;

export interface DiscoveredParam {
  index: number;
  name: string;
  description?: string;
  type: ToolParamSchema['type'];
  required: boolean;
}

export interface DiscoveredTool {
  methodName: string;
  /** Final name exposed to the LLM — falls back to methodName if @Tool.name is absent. */
  toolName: string;
  description: string;
  params: DiscoveredParam[];
  /** Parameter index that receives AgentContext, or undefined if @Context is not used. */
  contextParamIndex: number | undefined;
  /** Method-level policy constructors from @UsePolicies on the method. */
  policyConstructors: PolicyConstructor[];
  /** The ToolSet instance that owns this method — used for invocation. */
  instance: object;
}

export interface DiscoveredToolSet {
  options: ToolSetOptions;
  /** Class-level policy constructors from @UsePolicies on the ToolSet class. */
  classPolicyConstructors: PolicyConstructor[];
  tools: DiscoveredTool[];
}

@Injectable()
export class ToolDiscoveryService {
  /**
   * Scans a @ToolSet instance and extracts structured metadata
   * for all @Tool methods. Pure reflection — no policy execution or DI.
   */
  discover(instance: object): DiscoveredToolSet | null {
    const target = (instance.constructor || Object.getPrototypeOf(instance).constructor) as Function;
    const toolSetOptions: ToolSetOptions | undefined =
      Reflect.getMetadata(TOOLSET_METADATA, target) ||
      Reflect.getMetadata(TOOLSET_METADATA, instance);

    if (!toolSetOptions) {
      return null;
    }

    const classPolicyConstructors: PolicyConstructor[] =
      Reflect.getMetadata(TOOL_POLICIES_METADATA, target) ?? [];

    const prototype = Object.getPrototypeOf(instance);
    const methodNames = Object.getOwnPropertyNames(prototype).filter(
      (key) => key !== 'constructor' && typeof (prototype as Record<string, unknown>)[key] === 'function',
    );

    const tools: DiscoveredTool[] = [];

    for (const methodName of methodNames) {
      const toolOptions = this.getMethodMetadata<ToolOptions>(
        TOOL_METADATA,
        prototype,
        instance,
        target,
        methodName,
      );

      if (!toolOptions) {
        continue;
      }

      const rawParams =
        this.getMethodMetadata<ParamMetadata[]>(
          TOOL_PARAMS_METADATA,
          prototype,
          instance,
          target,
          methodName,
        ) ?? [];

      const params: DiscoveredParam[] = rawParams
        .sort((a, b) => a.index - b.index)
        .map((p) => ({
          index: p.index,
          name: p.name,
          description: p.options.description,
          type: p.options.type ?? 'string',
          required: p.options.required ?? true,
        }));

      const contextParamIndex = this.getMethodMetadata<number>(
        CONTEXT_PARAM_KEY,
        prototype,
        instance,
        target,
        methodName,
      );

      const policyConstructors =
        this.getMethodMetadata<PolicyConstructor[]>(
          TOOL_POLICIES_METADATA,
          prototype,
          instance,
          target,
          methodName,
        ) ?? [];

      tools.push({
        methodName,
        toolName: toolOptions.name ?? methodName,
        description: toolOptions.description ?? '',
        params,
        contextParamIndex,
        policyConstructors,
        instance,
      });
    }

    return { options: toolSetOptions, classPolicyConstructors, tools };
  }

  /**
   * Helper utility to extract method metadata supporting prototype, function target, and descriptor targets.
   */
  private getMethodMetadata<T>(
    key: symbol | string,
    prototype: object,
    instance: object,
    target: Function,
    methodName: string,
  ): T | undefined {
    const fn = Reflect.get(prototype, methodName) as unknown;
    const fnMeta = typeof fn === 'function' ? Reflect.getMetadata(key, fn) : undefined;

    return (
      Reflect.getMetadata(key, prototype, methodName) ??
      fnMeta ??
      Reflect.getMetadata(key, instance, methodName) ??
      Reflect.getMetadata(key, target, methodName)
    );
  }
}