import {
  McpCancelledError,
  McpConnectionError,
  McpProtocolError,
  McpTimeoutError,
  McpToolExecutionError,
} from '../errors/mcp.errors';
import {
  LATEST_MCP_PROTOCOL_VERSION,
  type CallToolParams,
  type CallToolResult,
  type InitializeRequestParams,
  type InitializeResult,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ListToolsResult,
  type McpToolSchema,
} from '../interfaces/mcp.interface';
import type { McpTransport } from '../interfaces/transport.interface';

export interface McpClientOptions {
  serverName: string;
  transport: McpTransport;
  timeoutMs?: number;
  clientInfo?: { name: string; version: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
  signal?: AbortSignal;
}

/**
 * Standard Model Context Protocol (MCP) client.
 * Handles protocol handshake, JSON-RPC correlation, cancellation propagation, tool discovery, and execution.
 */
export class McpClient {
  public readonly serverName: string;
  private readonly transport: McpTransport;
  private readonly timeoutMs: number;
  private readonly clientInfo: { name: string; version: string };

  private nextRequestId = 1;
  private readonly pendingRequests = new Map<string | number, PendingRequest>();
  private isConnected = false;
  private isInitialized = false;
  private cachedTools: McpToolSchema[] = [];
  private serverInfo: InitializeResult | null = null;

  private readonly toolsChangedListeners: (() => void)[] = [];

  constructor(options: McpClientOptions) {
    this.serverName = options.serverName;
    this.transport = options.transport;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.clientInfo = options.clientInfo ?? {
      name: 'nestjs-agentic',
      version: '0.6.0',
    };

    this.transport.onMessage((msg) => this.handleMessage(msg));
    this.transport.onError((err) => this.handleTransportError(err));
    this.transport.onClose(() => this.handleTransportClose());
  }

  /**
   * Connects transport and performs MCP initialization handshake.
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.isInitialized) return;

    await this.transport.connect();
    this.isConnected = true;

    // Step 1: Handshake with initialize request
    const initParams: InitializeRequestParams = {
      protocolVersion: LATEST_MCP_PROTOCOL_VERSION,
      capabilities: {
        roots: { listChanged: true },
      },
      clientInfo: this.clientInfo,
    };

    const initResult = (await this.request('initialize', initParams as unknown as Record<string, unknown>)) as InitializeResult;
    this.serverInfo = initResult;

    // Step 2: Send initialized notification
    await this.notify('notifications/initialized', {});
    this.isInitialized = true;
  }

  /**
   * Discovers and retrieves all tools exposed by the MCP server.
   * Caches results and returns cached list on subsequent invocations.
   */
  async listTools(forceRefresh = false): Promise<McpToolSchema[]> {
    if (!this.isInitialized) {
      await this.connect();
    }

    if (this.cachedTools.length > 0 && !forceRefresh) {
      return this.cachedTools;
    }

    const res = (await this.request('tools/list', {})) as ListToolsResult;
    this.cachedTools = res.tools ?? [];
    return this.cachedTools;
  }

  /**
   * Executes a remote MCP tool over JSON-RPC.
   *
   * @throws {McpToolExecutionError} if the tool fails on the server (`isError: true`).
   * @throws {McpCancelledError} if cancelled via AbortSignal.
   * @throws {McpTimeoutError} if execution exceeds the timeout budget.
   */
  async callTool(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<CallToolResult> {
    if (!this.isInitialized) {
      await this.connect();
    }

    const params: CallToolParams = {
      name,
      arguments: args,
    };

    const result = (await this.request(
      'tools/call',
      params as unknown as Record<string, unknown>,
      signal,
    )) as CallToolResult;

    if (result.isError) {
      const errorText = result.content
        .map((c) => (c.type === 'text' ? c.text : `[${c.type} block]`))
        .join('\n');
      throw new McpToolExecutionError(this.serverName, name, errorText || 'Tool execution reported error');
    }

    return result;
  }

  /**
   * Sends a ping health-check request to verify connectivity and keep transport alive.
   */
  async ping(): Promise<void> {
    if (!this.isInitialized) {
      await this.connect();
    }
    await this.request('ping', {});
  }

  /**
   * Registers a listener for dynamic tool change notifications (`notifications/tools/list_changed`).
   */
  onToolsChanged(listener: () => void): () => void {
    this.toolsChangedListeners.push(listener);
    return () => {
      const idx = this.toolsChangedListeners.indexOf(listener);
      if (idx !== -1) this.toolsChangedListeners.splice(idx, 1);
    };
  }

  /**
   * Closes the transport and rejects all in-flight pending requests.
   */
  async close(): Promise<void> {
    this.isConnected = false;
    this.isInitialized = false;

    // Reject all pending requests
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new McpConnectionError(this.serverName, 'Connection closed while request was in-flight'));
    }
    this.pendingRequests.clear();

    await this.transport.close();
  }

  // ---------------------------------------------------------------------------
  // JSON-RPC 2.0 Messaging
  // ---------------------------------------------------------------------------

  private async request(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) {
      throw new McpCancelledError(this.serverName, method);
    }

    const id = this.nextRequestId++;
    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      let abortHandler: (() => void) | undefined;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        reject(new McpTimeoutError(this.serverName, method, this.timeoutMs));
      }, this.timeoutMs);

      if (signal) {
        abortHandler = () => {
          this.pendingRequests.delete(id);
          clearTimeout(timer);
          // Send cancellation notification to server as per MCP specification
          this.notify('notifications/cancelled', { requestId: id, reason: 'user_cancelled' }).catch(() => {});
          reject(new McpCancelledError(this.serverName, method));
        };
        signal.addEventListener('abort', abortHandler, { once: true });
        if (signal.aborted) {
          abortHandler();
          return;
        }
      }

      this.pendingRequests.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
          reject(err);
        },
        timer,
        method,
        signal,
      });

      this.transport.send(message).catch((err) => {
        this.pendingRequests.delete(id);
        clearTimeout(timer);
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        reject(err);
      });
    });
  }

  private async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const message: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    await this.transport.send(message);
  }

  private handleMessage(message: JsonRpcMessage): void {
    // 1. Handle Responses (id present)
    if ('id' in message && message.id !== undefined && message.id !== null) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;

      this.pendingRequests.delete(message.id);

      const resp = message as JsonRpcResponse;
      if (resp.error) {
        pending.reject(
          new McpProtocolError(
            this.serverName,
            resp.error.code,
            resp.error.message,
            resp.error.data,
          ),
        );
      } else {
        pending.resolve(resp.result);
      }
      return;
    }

    // 2. Handle Server Notifications (no id)
    if ('method' in message) {
      const notif = message as JsonRpcNotification;
      if (notif.method === 'notifications/tools/list_changed') {
        // Invalidate cache and notify listeners
        this.cachedTools = [];
        for (const listener of this.toolsChangedListeners) {
          try {
            listener();
          } catch {
            // listener error suppression
          }
        }
      }
    }
  }

  private handleTransportError(error: Error): void {
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(error);
    }
    this.pendingRequests.clear();
  }

  private handleTransportClose(): void {
    this.isConnected = false;
    this.isInitialized = false;
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new McpConnectionError(this.serverName, 'Transport closed unexpectedly'));
    }
    this.pendingRequests.clear();
  }
}
