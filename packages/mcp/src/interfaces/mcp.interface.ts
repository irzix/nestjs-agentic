import type { ModuleMetadata, Type } from '@nestjs/common';
import type { McpTransport } from './transport.interface';

export const LATEST_MCP_PROTOCOL_VERSION = '2024-11-05';

// =============================================================================
// JSON-RPC 2.0 Primitives
// =============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// =============================================================================
// MCP Protocol Types (Anthropic Specification)
// =============================================================================

export interface McpImplementation {
  name: string;
  version: string;
}

export interface ServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: Record<string, unknown>;
}

export interface ClientCapabilities {
  roots?: {
    listChanged?: boolean;
  };
  sampling?: Record<string, unknown>;
}

export interface InitializeRequestParams {
  protocolVersion: string;
  capabilities: ClientCapabilities;
  clientInfo: McpImplementation;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: McpImplementation;
  instructions?: string;
}

export interface JsonSchemaProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | string;
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
}

export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  $schema?: string;
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: ToolInputSchema;
}

export interface ListToolsResult {
  tools: McpToolSchema[];
  nextCursor?: string;
}

export interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string; blob?: string } };

export interface CallToolResult {
  content: McpContentBlock[];
  isError?: boolean;
}

// =============================================================================
// NestJS MCP Configuration & Options
// =============================================================================

export interface StdioTransportOptions {
  type: 'stdio';
  /** Executable binary to spawn (e.g. 'python', 'npx', 'docker'). */
  command: string;
  /** Command-line arguments. */
  args?: string[];
  /** Subprocess environment variables. If omitted, passes sanitized parent env. */
  env?: Record<string, string>;
  /** Subprocess working directory. */
  cwd?: string;
}

export interface SseTransportOptions {
  type: 'sse';
  /** Remote HTTP SSE endpoint URL. */
  url: string;
  /** Optional custom headers (e.g. Authorization, API keys). */
  headers?: Record<string, string>;
}

export interface CustomTransportOptions {
  type: 'custom';
  transport: McpTransport;
}

export type McpServerTransportConfig =
  | StdioTransportOptions
  | SseTransportOptions
  | CustomTransportOptions;

export interface McpServerConfig {
  /** Unique server identifier (e.g. 'github', 'filesystem', 'docker-runner'). */
  name: string;
  /** Transport configuration. */
  transport: McpServerTransportConfig;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Optional list of NestJS policy constructors to enforce on tools from this server. */
  policies?: (new (...args: unknown[]) => unknown)[];
}

export interface McpModuleOptions {
  servers: McpServerConfig[];
}

export interface McpOptionsFactory {
  createMcpOptions(): Promise<McpModuleOptions> | McpModuleOptions;
}

export interface McpAsyncModuleOptions extends Pick<ModuleMetadata, 'imports'> {
  useExisting?: Type<McpOptionsFactory>;
  useClass?: Type<McpOptionsFactory>;
  useFactory?: (...args: unknown[]) => Promise<McpModuleOptions> | McpModuleOptions;
  inject?: unknown[];
}
