import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { AgentContext, ResolvedTool } from '@nestjs-agentic/core';
import { McpClient } from './client/mcp-client';
import { McpToolNotFoundError } from './errors/mcp.errors';
import type { McpModuleOptions, McpServerConfig } from './interfaces/mcp.interface';
import { McpToolProvider } from './provider/mcp-tool.provider';
import { SseClientTransport } from './transports/sse.transport';
import { StdioClientTransport } from './transports/stdio.transport';

export const MCP_MODULE_OPTIONS = 'MCP_MODULE_OPTIONS';

@Injectable()
export class McpService implements OnModuleInit, OnModuleDestroy {
  private readonly clients = new Map<string, McpClient>();
  private readonly providers = new Map<string, McpToolProvider>();

  constructor(@Inject(MCP_MODULE_OPTIONS) private readonly options: McpModuleOptions) {
    this.initializeServers(options.servers ?? []);
  }

  async onModuleInit(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.connect();
      } catch {
        // Non-blocking initialization allows lazy retry on first tool use
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.close();
      } catch {
        // error suppression on shutdown
      }
    }
    this.clients.clear();
    this.providers.clear();
  }

  /**
   * Retrieves an active `McpClient` by server name.
   */
  getClient(serverName: string): McpClient {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new McpToolNotFoundError(serverName, '*');
    }
    return client;
  }

  /**
   * Retrieves the `McpToolProvider` for a designated server.
   */
  getProvider(serverName: string): McpToolProvider {
    const provider = this.providers.get(serverName);
    if (!provider) {
      throw new McpToolNotFoundError(serverName, '*');
    }
    return provider;
  }

  /**
   * Discovers and resolves tools across all configured MCP servers.
   */
  async getAllTools(agentContext: AgentContext): Promise<ResolvedTool[]> {
    const toolPromises = Array.from(this.providers.values()).map((provider) =>
      provider.getTools(agentContext),
    );
    const toolArrays = await Promise.all(toolPromises);
    return toolArrays.flat();
  }

  private initializeServers(servers: McpServerConfig[]): void {
    for (const server of servers) {
      let transport;
      if (server.transport.type === 'stdio') {
        transport = new StdioClientTransport({
          serverName: server.name,
          command: server.transport.command,
          args: server.transport.args,
          env: server.transport.env,
          cwd: server.transport.cwd,
        });
      } else if (server.transport.type === 'sse') {
        transport = new SseClientTransport({
          serverName: server.name,
          url: server.transport.url,
          headers: server.transport.headers,
        });
      } else {
        transport = server.transport.transport;
      }

      const client = new McpClient({
        serverName: server.name,
        transport,
        timeoutMs: server.timeoutMs,
      });

      const provider = new McpToolProvider({
        client,
      });

      this.clients.set(server.name, client);
      this.providers.set(server.name, provider);
    }
  }
}
