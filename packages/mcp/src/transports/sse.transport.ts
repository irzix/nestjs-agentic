import http from 'http';
import https from 'https';
import { URL } from 'url';
import { McpConnectionError } from '../errors/mcp.errors';
import type { JsonRpcMessage } from '../interfaces/mcp.interface';
import type { McpTransport } from '../interfaces/transport.interface';

export interface SseTransportConfig {
  serverName: string;
  url: string;
  headers?: Record<string, string>;
}

/**
 * Server-Sent Events (SSE) client transport for remote HTTP tool servers.
 * Listens on the SSE stream for incoming JSON-RPC frames and dispatches outgoing requests via HTTP POST.
 */
export class SseClientTransport implements McpTransport {
  private sseReq: http.ClientRequest | null = null;
  private postEndpointUrl: string | null = null;
  private isClosing = false;

  private messageHandler: ((message: JsonRpcMessage) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(private readonly config: SseTransportConfig) {}

  async connect(): Promise<void> {
    if (this.sseReq) return;

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(this.config.url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const reqHeaders: Record<string, string> = {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...this.config.headers,
      };

      const req = client.request(
        parsedUrl,
        {
          method: 'GET',
          headers: reqHeaders,
        },
        (res) => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            const err = new McpConnectionError(
              this.config.serverName,
              `SSE connection rejected with status code ${res.statusCode} ${res.statusMessage}`,
            );
            if (this.errorHandler) this.errorHandler(err);
            reject(err);
            return;
          }

          res.setEncoding('utf8');
          let sseBuffer = '';

          res.on('data', (chunk: string) => {
            sseBuffer += chunk;
            const events = sseBuffer.split('\n\n');
            sseBuffer = events.pop() ?? '';

            for (const eventBlock of events) {
              this.handleSseEvent(eventBlock, parsedUrl);
            }
          });

          res.on('end', () => {
            if (!this.isClosing && this.closeHandler) {
              this.closeHandler();
            }
          });

          resolve();
        },
      );

      req.on('error', (err) => {
        const errorObj = new McpConnectionError(
          this.config.serverName,
          `SSE request failed: ${err.message}`,
          err,
        );
        if (this.errorHandler) this.errorHandler(errorObj);
        reject(errorObj);
      });

      this.sseReq = req;
      req.end();
    });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.postEndpointUrl) {
      throw new McpConnectionError(
        this.config.serverName,
        'Cannot send message: SSE endpoint has not been established yet.',
      );
    }

    const parsedEndpoint = new URL(this.postEndpointUrl);
    const isHttps = parsedEndpoint.protocol === 'https:';
    const client = isHttps ? https : http;

    const payload = JSON.stringify(message);

    return new Promise((resolve, reject) => {
      const req = client.request(
        parsedEndpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            ...this.config.headers,
          },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
              reject(
                new McpConnectionError(
                  this.config.serverName,
                  `POST to ${this.postEndpointUrl} returned status ${res.statusCode}: ${body}`,
                ),
              );
            } else {
              resolve();
            }
          });
        },
      );

      req.on('error', (err) => {
        reject(
          new McpConnectionError(
            this.config.serverName,
            `Failed to send POST request to ${this.postEndpointUrl}: ${err.message}`,
            err,
          ),
        );
      });

      req.write(payload);
      req.end();
    });
  }

  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  async close(): Promise<void> {
    this.isClosing = true;
    if (this.sseReq) {
      this.sseReq.destroy();
      this.sseReq = null;
    }
  }

  private handleSseEvent(eventBlock: string, baseUrl: URL): void {
    const lines = eventBlock.split('\n');
    let eventType = 'message';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += line.slice(5).trim();
      }
    }

    if (eventType === 'endpoint') {
      try {
        // Resolve relative or absolute endpoint URL
        this.postEndpointUrl = new URL(data, baseUrl).toString();
      } catch {
        this.postEndpointUrl = data;
      }
      return;
    }

    if (data && this.messageHandler) {
      try {
        const parsed = JSON.parse(data) as JsonRpcMessage;
        this.messageHandler(parsed);
      } catch {
        // invalid JSON data frame ignored
      }
    }
  }
}
