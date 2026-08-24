import type { AgentContext, PolicyOutputResult, PolicyResult, ToolPolicy } from '../interfaces';
import { traverseAndRedact } from '../utils/redaction-traversal';

/**
 * Options for configuring SecretRedactionPolicy.
 */
export interface SecretRedactionPolicyOptions {
  /** Custom regular expression patterns to match and redact. */
  customPatterns?: RegExp[];

  /** Sensitive object key names to redact automatically. Default includes common secret keys. */
  sensitiveKeys?: string[];

  /** Mask replacement string. Default: `'[REDACTED_SECRET]'` */
  maskPlaceholder?: string;

  /** Maximum object traversal depth to prevent stack overflows. Default: `50` */
  maxDepth?: number;
}

/**
 * Built-in Output Rail policy that automatically detects and redacts credentials,
 * API tokens, JWTs, private keys, and database connection strings from tool output
 * before it is returned to the model reasoning loop.
 *
 * Preserves circular object graph structures safely using WeakMap clone mapping,
 * ensuring no references to unredacted original objects are leaked.
 *
 * @see Greshake et al. (USENIX Security 2023, arXiv:2302.12173)
 * @see Rebedea et al. (NVIDIA NeMo Guardrails, arXiv:2310.10501)
 *
 * @example
 * ```typescript
 * @Tool({ name: 'fetch_user_profile' })
 * @UsePolicies(new SecretRedactionPolicy())
 * async fetchUserProfile() { ... }
 * ```
 */
export class SecretRedactionPolicy implements ToolPolicy {
  private readonly patterns: RegExp[];
  private readonly sensitiveKeys: Set<string>;
  private readonly maskPlaceholder: string;
  private readonly maxDepth: number;

  private static readonly DEFAULT_PATTERNS: RegExp[] = [
    // OpenAI API Keys
    /sk-[a-zA-Z0-9_\-]{20,}/g,
    // GitHub Personal Access Tokens
    /ghp_[a-zA-Z0-9]{36}/g,
    /github_pat_[a-zA-Z0-9_]{82}/g,
    // AWS Access Key IDs
    /AKIA[0-9A-Z]{16}/g,
    // JWT Tokens
    /eyJ[a-zA-Z0-9_\-]{10,}\.eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]+/g,
    // PEM Private Keys
    /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/g,
    // Database Connection Strings with Passwords
    /(?:postgres|postgresql|mongodb|mysql|redis):\/\/[^:\s]+:[^@\s]+@[^\s"'<>]+/gi,
  ];

  private static readonly DEFAULT_SENSITIVE_KEYS = [
    'password',
    'pass',
    'secret',
    'token',
    'apiKey',
    'apikey',
    'api_key',
    'authorization',
    'privateKey',
    'private_key',
    'accessToken',
    'access_token',
  ];

  constructor(options?: SecretRedactionPolicyOptions) {
    this.patterns = [...SecretRedactionPolicy.DEFAULT_PATTERNS, ...(options?.customPatterns ?? [])];
    this.sensitiveKeys = new Set(options?.sensitiveKeys ?? SecretRedactionPolicy.DEFAULT_SENSITIVE_KEYS);
    this.maskPlaceholder = options?.maskPlaceholder ?? '[REDACTED_SECRET]';
    this.maxDepth = options?.maxDepth ?? 50;
  }

  /**
   * Pre-execution policy hook: allows tool invocation.
   */
  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    _args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    return { decision: 'allow' };
  }

  /**
   * Post-execution Output Rail hook: inspects and redacts sensitive data from the tool output.
   */
  async evaluateOutput(
    _ctx: AgentContext,
    _toolName: string,
    result: unknown,
  ): Promise<PolicyOutputResult> {
    if (result === undefined || result === null) {
      return { decision: 'allow' };
    }

    const { value, modified, keyCollision } = traverseAndRedact(result, {
      maxDepth: this.maxDepth,
      transformString: (text) => this.redactString(text),
      handleKey: (key, keyValue) => {
        if (this.sensitiveKeys.has(key) && typeof keyValue === 'string') {
          return { handled: true, value: this.maskPlaceholder };
        }
        return { handled: false };
      },
    });

    // Redacting Map keys collapsed two distinct keys into one, which would silently
    // drop an entry — fail closed rather than return a Map that lost data.
    if (keyCollision) {
      return {
        decision: 'deny',
        reason: 'Redacting secrets in Map keys produced a key collision; refusing to return output that would silently drop an entry.',
      };
    }

    if (modified) {
      return { decision: 'sanitize', sanitizedResult: value };
    }

    return { decision: 'allow' };
  }

  private redactString(text: string): string {
    let sanitized = text;
    for (const pattern of this.patterns) {
      // Create a fresh regex with global flag to avoid state issues
      const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      sanitized = sanitized.replace(regex, this.maskPlaceholder);
    }
    return sanitized;
  }
}
