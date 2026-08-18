import { spawn, type ChildProcess } from 'child_process';
import { McpConnectionError } from '../errors/mcp.errors';
import type { JsonRpcMessage } from '../interfaces/mcp.interface';
import type { McpTransport } from '../interfaces/transport.interface';
import { sanitizeStderr } from '../utils/schema-converter';

export interface StdioTransportConfig {
  serverName: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Standard I/O (stdio) transport client for local sub-processes and containers.
 * Connects to MCP servers over stdin/stdout using newline-delimited JSON-RPC messages.
 */
export class StdioClientTransport implements McpTransport {
  private process: ChildProcess | null = null;
  private messageBuffer = '';
  private isClosing = false;

  private messageHandler: ((message: JsonRpcMessage) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(private readonly config: StdioTransportConfig) {}

  async connect(): Promise<void> {
    if (this.process) return;

    // Filter environment variables according to OWASP least-privilege principles
    const baseEnv = process.env;
    const processEnv: NodeJS.ProcessEnv = {
      PATH: baseEnv.PATH,
      HOME: baseEnv.HOME,
      USER: baseEnv.USER,
      NODE_ENV: baseEnv.NODE_ENV,
      ...this.config.env,
    };

    try {
      this.process = spawn(this.config.command, this.config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: processEnv,
        cwd: this.config.cwd,
        shell: false,
      });
    } catch (err: unknown) {
      throw new McpConnectionError(
        this.config.serverName,
        `Failed to spawn process "${this.config.command}": ${(err as Error).message}`,
        err,
      );
    }

    if (!this.process.stdout || !this.process.stdin || !this.process.stderr) {
      throw new McpConnectionError(
        this.config.serverName,
        'Spawned process does not have valid stdio streams.',
      );
    }

    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', (chunk: string) => this.handleStdoutData(chunk));

    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', (chunk: string) => {
      const sanitized = sanitizeStderr(chunk);
      // Stderr is diagnostic in MCP; non-fatal logging
    });

    this.process.on('error', (err: Error) => {
      if (!this.isClosing && this.errorHandler) {
        this.errorHandler(
          new McpConnectionError(this.config.serverName, `Process error: ${err.message}`, err),
        );
      }
    });

    this.process.on('exit', (code, signal) => {
      if (!this.isClosing && this.closeHandler) {
        this.closeHandler();
      }
      this.process = null;
    });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.process || !this.process.stdin || this.process.killed) {
      throw new McpConnectionError(
        this.config.serverName,
        'Cannot send message: stdio process is not running or connected.',
      );
    }

    const payload = JSON.stringify(message) + '\n';
    return new Promise((resolve, reject) => {
      this.process!.stdin!.write(payload, 'utf8', (err) => {
        if (err) {
          reject(
            new McpConnectionError(
              this.config.serverName,
              `Failed to write to stdin: ${err.message}`,
              err,
            ),
          );
        } else {
          resolve();
        }
      });
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
    if (!this.process) return;

    return new Promise<void>((resolve) => {
      const proc = this.process!;
      const killTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      }, 2000);

      proc.once('exit', () => {
        clearTimeout(killTimer);
        this.process = null;
        resolve();
      });

      try {
        proc.stdin?.end();
        proc.kill('SIGTERM');
      } catch {
        proc.kill('SIGKILL');
      }
    });
  }

  private handleStdoutData(chunk: string): void {
    this.messageBuffer += chunk;
    const lines = this.messageBuffer.split('\n');
    this.messageBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed) as JsonRpcMessage;
        if (this.messageHandler) {
          this.messageHandler(parsed);
        }
      } catch {
        // Non-JSON line ignored (logging / framing)
      }
    }
  }
}
