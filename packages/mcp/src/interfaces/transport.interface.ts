import type { JsonRpcMessage } from './mcp.interface';

/**
 * Low-level bidirectional communication transport interface for Model Context Protocol.
 * Decouples JSON-RPC message framing from physical medium (stdio, SSE, WebSocket).
 */
export interface McpTransport {
  /**
   * Establishes the transport connection (spawns subprocess or opens HTTP/SSE stream).
   */
  connect(): Promise<void>;

  /**
   * Sends a framed JSON-RPC message to the remote peer.
   */
  send(message: JsonRpcMessage): Promise<void>;

  /**
   * Registers a callback invoked whenever a valid JSON-RPC message is received.
   */
  onMessage(handler: (message: JsonRpcMessage) => void): void;

  /**
   * Registers a callback invoked when a transport-level error occurs.
   */
  onError(handler: (error: Error) => void): void;

  /**
   * Registers a callback invoked when the transport connection closes.
   */
  onClose(handler: () => void): void;

  /**
   * Gracefully shuts down the transport and cleans up OS handles/subprocesses.
   */
  close(): Promise<void>;
}
