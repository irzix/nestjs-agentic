/**
 * Scrubs an error before it is handed to observers.
 *
 * Observers commonly forward events to third-party telemetry, and provider SDK
 * errors routinely carry request configuration, headers, response bodies, and
 * prompt content. A redactor decides what of an error is allowed to leave the
 * process.
 *
 * It must return an `Error` so observers can keep reading `name`, `message`,
 * and `stack`, and it should not throw: if it does, `ObserverNotifier` replaces
 * the error with a placeholder rather than falling back to the raw value.
 */
export interface ErrorRedactor {
  (error: unknown): Error;
  /**
   * Scrubs free text that embeds an error message: a circuit-breaker reason,
   * or the `error` of a failed tool's result. Optional. Without it,
   * `ObserverNotifier` wraps the text in an `Error`, redacts that, and keeps
   * the resulting `message`. `createErrorRedactor` provides it.
   */
  redactText?(text: string): string;
}

/**
 * Observability settings for `AgenticModuleOptions.observability`.
 */
export interface ObservabilityOptions {
  /**
   * How errors are scrubbed before observers receive them. Applies to
   * `AgentErrorEvent.error`, `ModelRetryEvent.error`,
   * `CircuitBreakerEvent.reason` (which embeds the failing call's message),
   * and the `error` text of failed tool results in `ToolResultEvent` and
   * `AgentEndEvent`.
   *
   * Defaults to `defaultErrorRedactor`. Pass your own `ErrorRedactor` to keep
   * more or less, or `'none'` to hand observers the original error, for
   * example to a local debug observer that never leaves the process.
   */
  errorRedaction?: ErrorRedactor | 'none';
}

/**
 * Options for `createErrorRedactor`.
 */
export interface ErrorRedactorOptions {
  /** Longest message kept, in characters. Longer messages are truncated. Default: `500`. */
  maxMessageLength?: number;
  /** How many links of a `cause` chain are kept. Deeper causes are dropped. Default: `3`. */
  maxCauseDepth?: number;
  /** Extra patterns masked in messages and stack frames, in addition to the built-in ones. */
  patterns?: RegExp[];
  /** Replacement for masked values. Default: `'[REDACTED]'`. */
  mask?: string;
}

/**
 * The error observers receive after redaction: an allowlisted copy of the
 * original holding only `name`, a masked and length-capped `message`, numeric
 * `status`/`statusCode`, a short `code`, stack frames, and a redacted `cause`.
 */
export class RedactedError extends Error {
  status?: number;
  statusCode?: number;
  code?: string | number;
  cause?: RedactedError;

  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

const DEFAULT_MAX_MESSAGE_LENGTH = 500;
const DEFAULT_MAX_CAUSE_DEPTH = 3;
const DEFAULT_MASK = '[REDACTED]';
const MAX_NAME_LENGTH = 100;
const MAX_CODE_LENGTH = 100;
const MAX_STACK_FRAMES = 50;
/** Longest stack frame kept; longer frames keep their end, where the location is. */
const MAX_FRAME_LENGTH = 300;
/**
 * How much of a message is scanned, as a multiple of the kept length.
 * Masking runs before truncation so a secret near the cut is masked whole,
 * and scanning a bounded window keeps the cost flat when an SDK puts a whole
 * response body in the message.
 */
const SCAN_WINDOW_FACTOR = 4;

/**
 * Credential-like key names. A key may carry a prefix, so `DB_PASSWORD`,
 * `OPENAI_API_KEY`, and `aws_secret_access_key` match, but it must end at
 * the keyword, so `max_tokens` does not.
 */
const SENSITIVE_KEYS = [
  '(?:x-)?api[_-]?key',
  'access[_-]?key',
  'secret[_-]?key',
  'private[_-]?key',
  'access[_-]?token',
  'refresh[_-]?token',
  'id[_-]?token',
  'auth[_-]?token',
  'client[_-]?secret',
  'session[_-]?id',
  '(?:proxy-)?authorization',
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'sig',
].join('|');

/** Rewrites one match, given the mask and the match's capture groups. */
type Replacer = (mask: string, groups: string[]) => string;

/** Credential shapes masked wherever they appear in a message. */
const BUILT_IN_PATTERNS: ReadonlyArray<{ pattern: RegExp; replace: Replacer }> = [
  // Cookie headers hold several `name=value` pairs, so mask to the end of the line.
  {
    pattern: /\b((?:set-)?cookie)(["']?\s*[:=]\s*)[^\r\n]+/gi,
    replace: (mask, [key, separator]) => `${key}${separator}${mask}`,
  },
  // `Authorization: Bearer abc`, `DB_PASSWORD=abc`, `"password": "a b c"`, and
  // the same inside escaped JSON (`\"api_key\":\"abc\"`). A quoted value is
  // masked to its closing quote, or to the end of the text if it was cut off.
  // The key is kept so the message still says what was wrong.
  {
    pattern: new RegExp(
      `\\b((?:[A-Za-z0-9]+[_.-])*(?:${SENSITIVE_KEYS}))` +
        `(\\\\?["']?\\s*[:=]\\s*)` +
        `(?:(\\\\?")(?:\\\\.|[^"\\\\])*?(?:\\\\?"|$)|(')[^']*(?:'|$)|(?:(?:bearer|basic|token)\\s+)?[^\\s"'\\\\,;&}\\]]+)`,
      'gi',
    ),
    replace: (mask, [key, separator, doubleQuote, singleQuote]) => {
      const quote = doubleQuote || singleQuote;
      return `${key}${separator}${quote}${mask}${quote}`;
    },
  },
  // Bare `Bearer abc` or `Basic abc` without a key in front.
  {
    pattern: /\b(Bearer|Basic)(\s+)[A-Za-z0-9\-._~+/]{8,}=*/gi,
    replace: (mask, [scheme, space]) => `${scheme}${space}${mask}`,
  },
  // Credentials embedded in a URL: scheme://user:password@host. The password
  // may itself contain `/` or `@`, so everything up to the last `@` goes.
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:\S*@/gi,
    replace: (mask, [scheme]) => `${scheme}${mask}@`,
  },
  // Provider keys: OpenAI and Anthropic (`sk-`, `sk-ant-`, `sk-proj-`).
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}/g, replace: (mask) => mask },
  // GitHub tokens.
  { pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, replace: (mask) => mask },
  // AWS access key IDs.
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: (mask) => mask },
  // Google API keys.
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}/g, replace: (mask) => mask },
  // Slack tokens.
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, replace: (mask) => mask },
  // JWTs.
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, replace: (mask) => mask },
  // PEM private keys, including one cut off before its END line.
  {
    pattern: /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?(?:-----END[ A-Z0-9_-]*PRIVATE KEY-----|$)/g,
    replace: (mask) => mask,
  },
];

/** Reads a property without letting a throwing getter or proxy escape. */
function read(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Builds an `ErrorRedactor` that keeps an allowlist of diagnostic fields and
 * drops everything else.
 *
 * Kept: `name`, `message` (credential-shaped values masked, then capped),
 * numeric `status` and `statusCode`, a short string or numeric `code`, stack
 * frames (the `at …` lines, masked), and `cause`, redacted the same way to
 * `maxCauseDepth` links.
 *
 * Dropped: every other property, including request configuration, headers,
 * response bodies, non-enumerable and `Symbol`-keyed properties, and the
 * `errors` of an `AggregateError`.
 */
export function createErrorRedactor(options: ErrorRedactorOptions = {}): ErrorRedactor {
  const maxMessageLength = options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH;
  const maxCauseDepth = options.maxCauseDepth ?? DEFAULT_MAX_CAUSE_DEPTH;
  const mask = options.mask ?? DEFAULT_MASK;
  if (!(Number.isInteger(maxMessageLength) && maxMessageLength >= 0)) {
    throw new Error(`maxMessageLength must be a non-negative integer, received ${maxMessageLength}.`);
  }
  if (!(Number.isInteger(maxCauseDepth) && maxCauseDepth >= 0)) {
    throw new Error(`maxCauseDepth must be a non-negative integer, received ${maxCauseDepth}.`);
  }

  // Rebuilt as global and never sticky: a sticky pattern would only match at
  // the start of the text.
  const extra = (options.patterns ?? []).map((pattern) => ({
    pattern: new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, '')}g`),
    replace: ((m: string) => m) as Replacer,
  }));
  const patterns = [...BUILT_IN_PATTERNS, ...extra];

  const maskText = (text: string): string => {
    let out = text;
    for (const { pattern, replace } of patterns) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, (_match: string, ...rest: unknown[]) => {
        // Capture groups come first, followed by the numeric match offset.
        const offsetAt = rest.findIndex((arg) => typeof arg === 'number');
        const groups = rest.slice(0, offsetAt).map((group) => (typeof group === 'string' ? group : ''));
        return replace(mask, groups);
      });
    }
    return out;
  };

  const capped = (text: string, limit: number): string =>
    text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text;

  const redactMessage = (text: string): string => {
    const window = Math.max(maxMessageLength, 1) * SCAN_WINDOW_FACTOR;
    if (text.length <= window) {
      return capped(maskText(text), maxMessageLength);
    }
    // Cut at whitespace, so no token straddles the cut: a secret that would
    // is dropped whole rather than left half-matched and unmasked.
    const cut = Math.max(
      text.lastIndexOf(' ', window),
      text.lastIndexOf('\n', window),
      text.lastIndexOf('\t', window),
    );
    const masked = maskText(text.slice(0, Math.max(cut, 0)));
    return masked.length > maxMessageLength ? capped(masked, maxMessageLength) : `${masked}…[truncated]`;
  };

  /** Keeps the end of a long frame, where its file:line:column is. */
  const frame = (line: string): string => {
    const masked = maskText(line);
    return masked.length > MAX_FRAME_LENGTH ? `…${masked.slice(-MAX_FRAME_LENGTH)}` : masked;
  };

  const redactOne = (error: unknown, depth: number, seen: Set<object>): RedactedError => {
    if (typeof error !== 'object' || error === null) {
      return new RedactedError('Error', redactMessage(String(error)));
    }
    seen.add(error);

    const rawName = read(error, 'name');
    const name = typeof rawName === 'string' && rawName ? capped(maskText(rawName), MAX_NAME_LENGTH) : 'Error';
    const rawMessage = read(error, 'message');
    const message = typeof rawMessage === 'string' ? redactMessage(rawMessage) : '';

    const redacted = new RedactedError(name, message);

    const status = read(error, 'status');
    if (typeof status === 'number' && Number.isFinite(status)) redacted.status = status;
    const statusCode = read(error, 'statusCode');
    if (typeof statusCode === 'number' && Number.isFinite(statusCode)) redacted.statusCode = statusCode;
    const code = read(error, 'code');
    if (typeof code === 'number' && Number.isFinite(code)) {
      redacted.code = code;
    } else if (typeof code === 'string') {
      redacted.code = capped(maskText(code), MAX_CODE_LENGTH);
    }

    // Keep the original frames, which point at the code that failed, under a
    // header rebuilt from the redacted name and message.
    const rawStack = read(error, 'stack');
    const frames = typeof rawStack === 'string' ? stackFrames(rawStack, rawMessage).map(frame) : [];
    redacted.stack = [`${name}${message ? `: ${message}` : ''}`, ...frames].join('\n');

    const cause = read(error, 'cause');
    if (
      cause !== undefined &&
      cause !== null &&
      depth < maxCauseDepth &&
      !(typeof cause === 'object' && seen.has(cause))
    ) {
      redacted.cause = redactOne(cause, depth + 1, seen);
    }
    return redacted;
  };

  return Object.assign((error: unknown) => redactOne(error, 0, new Set<object>()), {
    redactText: redactMessage,
  });
}

/**
 * The `at …` frames of a stack, without its header. V8 starts the stack with
 * the raw message, which may itself contain lines that look like frames (an
 * upstream trace quoted in the message), so frames are only read after the
 * message. When the message cannot be located, no frames are kept.
 */
function stackFrames(stack: string, rawMessage: unknown): string[] {
  let body: string;
  if (typeof rawMessage === 'string' && rawMessage) {
    const at = stack.indexOf(rawMessage);
    if (at === -1 || stack.slice(0, at).includes('\n')) return [];
    body = stack.slice(at + rawMessage.length);
  } else {
    const newline = stack.indexOf('\n');
    body = newline === -1 ? '' : stack.slice(newline);
  }
  return body
    .split('\n')
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, MAX_STACK_FRAMES);
}

/** The redactor `ObserverNotifier` uses unless configured otherwise. */
export const defaultErrorRedactor: ErrorRedactor = createErrorRedactor();
