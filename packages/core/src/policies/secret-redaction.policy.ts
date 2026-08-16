import type { AgentContext, PolicyOutputResult, PolicyResult, ToolPolicy } from '../interfaces';

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

    let modified = false;
    const sanitized = this.redactUnknown(
      result,
      () => {
        modified = true;
      },
      new WeakMap<object, unknown>(),
      0,
    );

    if (modified) {
      return { decision: 'sanitize', sanitizedResult: sanitized };
    }

    return { decision: 'allow' };
  }

  private redactUnknown(
    value: unknown,
    onModified: () => void,
    seenMap: WeakMap<object, unknown>,
    depth: number,
  ): unknown {
    if (depth > this.maxDepth) {
      return value;
    }

    if (typeof value === 'string') {
      return this.redactString(value, onModified);
    }

    if (typeof value === 'object' && value !== null) {
      // If we've already created a sanitized node for this original object, return it
      if (seenMap.has(value as object)) {
        return seenMap.get(value as object);
      }

      // Create placeholder (array or object) and store before recursing into children
      const placeholder: any = Array.isArray(value) ? [] : {};
      seenMap.set(value as object, placeholder);

      if (Array.isArray(value)) {
        for (const item of value) {
          placeholder.push(this.redactUnknown(item, onModified, seenMap, depth + 1));
        }
        return placeholder;
      }

      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (this.sensitiveKeys.has(k) && typeof v === 'string') {
          placeholder[k] = this.maskPlaceholder;
          onModified();
        } else {
          placeholder[k] = this.redactUnknown(v, onModified, seenMap, depth + 1);
        }
      }
      return placeholder;
    }

    return value;
  }

  private redactString(text: string, onModified: () => void): string {
    let sanitized = text;
    for (const pattern of this.patterns) {
      // Create a fresh regex with global flag to avoid state issues
      const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      if (regex.test(sanitized)) {
        sanitized = sanitized.replace(regex, this.maskPlaceholder);
        onModified();
      }
    }
    return sanitized;
  }
}
