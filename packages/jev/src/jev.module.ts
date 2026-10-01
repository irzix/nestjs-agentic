import { Module } from '@nestjs/common';
import type { DynamicModule, FactoryProvider } from '@nestjs/common';
import type { JevClient } from './jev.interface';

/** Injection token for the shared `JevClient`. */
export const JEV_CLIENT = Symbol('JEV_CLIENT');

/** Injection token for module-wide defaults (`model`, `timeoutMs`). */
export const JEV_DEFAULTS = Symbol('JEV_DEFAULTS');

export interface JevModuleOptions {
  /** Usually `new TypeSafeClient()` from `@typesafe-ai/sdk`, which reads `TYPESAFE_API_KEY`. */
  client: JevClient;
  /** Default model for every gate and judge, e.g. a pinned `'jev-1.13.0'`. */
  model?: string;
  /** Default per-call timeout in milliseconds. */
  timeoutMs?: number;
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
        { provide: JEV_DEFAULTS, useValue: { model: options.model, timeoutMs: options.timeoutMs } },
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
        {
          provide: JEV_DEFAULTS,
          useFactory: (resolved: JevModuleOptions): JevDefaults => ({
            model: resolved.model,
            timeoutMs: resolved.timeoutMs,
          }),
          inject: [OPTIONS],
        },
      ],
      exports: [JEV_CLIENT, JEV_DEFAULTS],
    };
  }
}
