import { DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import type {
  McpAsyncModuleOptions,
  McpModuleOptions,
  McpOptionsFactory,
} from './interfaces/mcp.interface';
import { MCP_MODULE_OPTIONS, McpService } from './mcp.service';

@Global()
@Module({})
export class McpModule {
  /**
   * Synchronously registers MCP server configurations.
   */
  static register(options: McpModuleOptions): DynamicModule {
    return {
      module: McpModule,
      providers: [
        {
          provide: MCP_MODULE_OPTIONS,
          useValue: options,
        },
        McpService,
      ],
      exports: [McpService],
    };
  }

  /**
   * Asynchronously registers MCP server configurations with dependency injection.
   */
  static registerAsync(options: McpAsyncModuleOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);
    return {
      module: McpModule,
      imports: options.imports ?? [],
      providers: [...asyncProviders, McpService],
      exports: [McpService],
    };
  }

  private static createAsyncProviders(options: McpAsyncModuleOptions): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: MCP_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: (options.inject as (string | symbol | Function)[]) ?? [],
        },
      ];
    }

    const useClassOrExisting = options.useClass ?? options.useExisting;
    if (!useClassOrExisting) {
      throw new Error('Invalid McpModule async configuration: must provide useFactory, useClass, or useExisting.');
    }

    return [
      {
        provide: MCP_MODULE_OPTIONS,
        useFactory: async (optionsFactory: McpOptionsFactory) =>
          optionsFactory.createMcpOptions(),
        inject: [useClassOrExisting],
      },
      ...(options.useClass ? [{ provide: options.useClass, useClass: options.useClass }] : []),
    ];
  }
}
