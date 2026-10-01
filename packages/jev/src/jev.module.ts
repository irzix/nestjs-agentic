import { Module } from '@nestjs/common';
import type { DynamicModule, FactoryProvider } from '@nestjs/common';
import { CircuitBreaker } from '@nestjs-agentic/core';
import { assertTimeout } from './ask-jev';
import type { JevClient } from './jev.interface';

/** Injection token for the shared `JevClient`. */
export const JEV_CLIENT = Symbol('JEV_CLIENT');

/** Injection token for module-wide defaults (`model`, `timeoutMs`). */
export const JEV_DEFAULTS = Symbol('JEV_DEFAULTS');

export interface JevModuleOptions {
  /** Usually `new TypeSafeClient()` from `@typesafe-ai/sdk`, which reads `TYPESAFE_API_KEY`. */
  client: JevClient;
  /** Default model for gates that use this client, e.g. a pinned `'jev-1.13.0'`. */
  model?: string;
  /** Default per-call timeout in milliseconds for every gate. */
  timeoutMs?: number;
  /**
   * Shared by the gates that use this client, so once Jev has failed
   * repeatedly they stop waiting on it and follow `onError` at once.
   * Default: a breaker that opens after 5 consecutive failures and probes
   * again after 30 seconds. `false` turns it off.
   */
  circuitBreaker?: CircuitBreaker | false;
}

export interface JevModuleAsyncOptions {
  useFactory: (...args: never[]) => JevModuleOptions | Promise<JevModuleOptions>;
  inject?: FactoryProvider['inject'];
  imports?: DynamicModule['imports'];
}

/** Defaults resolved by `JevModule` and read by the gates it serves. */
export interface JevDefaults {
  model?: string;
  timeoutMs?: number;
  circuitBreaker?: CircuitBreaker;
}

function toDefaults(options: JevModuleOptions): JevDefaults {
  assertTimeout(options.timeoutMs, 'JevModule');
  return {
    model: options.model,
    timeoutMs: options.timeoutMs,
    circuitBreaker:
      options.circuitBreaker === false ? undefined : (options.circuitBreaker ?? new CircuitBreaker('jev')),
  };
}

/**
 * Provides one `JevClient` to every Jev gate in the application. Global, so
 * gates registered through `AgenticModule.forFeature({ policies })` in any
 * module can inject it.
 *
 * Optional: a gate given its own `client` needs no module.
 *
 * @example
 * JevModule.forRoot({ client: new TypeSafeClient(), model: 'jev-1.13.0' })
 */
@Module({})
export class JevModule {
  static forRoot(options: JevModuleOptions): DynamicModule {
    return {
      module: JevModule,
      global: true,
      providers: [
        { provide: JEV_CLIENT, useValue: options.client },
        { provide: JEV_DEFAULTS, useValue: toDefaults(options) },
      ],
      exports: [JEV_CLIENT, JEV_DEFAULTS],
    };
  }

  /**
   * @example
   * JevModule.forRootAsync({
   *   inject: [ConfigService],
   *   useFactory: (config: ConfigService) => ({
   *     client: new TypeSafeClient({ apiKey: config.getOrThrow('TYPESAFE_API_KEY') }),
   *   }),
   * })
   */
  static forRootAsync(options: JevModuleAsyncOptions): DynamicModule {
    const OPTIONS = Symbol('JEV_MODULE_OPTIONS');
    return {
      module: JevModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        { provide: OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        { provide: JEV_CLIENT, useFactory: (resolved: JevModuleOptions) => resolved.client, inject: [OPTIONS] },
        { provide: JEV_DEFAULTS, useFactory: toDefaults, inject: [OPTIONS] },
      ],
      exports: [JEV_CLIENT, JEV_DEFAULTS],
    };
  }
}
