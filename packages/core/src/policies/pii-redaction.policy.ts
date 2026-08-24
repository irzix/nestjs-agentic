import type { AgentContext, PolicyOutputResult, PolicyResult, ToolPolicy } from '../interfaces';
import { traverseAndRedact } from '../utils/redaction-traversal';

/**
 * Options for configuring PiiRedactionPolicy.
 *
 * Each built-in category can be independently toggled. All default to `true`.
 */
export interface PiiRedactionPolicyOptions {
  /** Redact email addresses. Default: `true` */
  redactEmail?: boolean;

  /** Redact phone numbers (NANP and a generic `+countryCode`-prefixed international format). Default: `true` */
  redactPhone?: boolean;

  /** Redact credit card numbers, validated with a Luhn checksum to reduce false positives. Default: `true` */
  redactCreditCard?: boolean;

  /** Redact US Social Security Numbers (`###-##-####`). Default: `true` */
  redactSsn?: boolean;

  /** Additional custom regular expression patterns to match and redact. */
  customPatterns?: RegExp[];

  /**
   * Object key names whose string value is redacted wholesale, regardless of
   * content — useful for PII categories that resist reliable regex detection
   * (e.g. physical addresses). Empty by default.
   */
  sensitiveKeys?: string[];

  /** Mask replacement string used for every category. Default: category-specific placeholders (see below). */
  maskPlaceholder?: string;

  /** Maximum object traversal depth to prevent stack overflows. Default: `50` */
  maxDepth?: number;
}

const DEFAULT_PLACEHOLDERS = {
  email: '[REDACTED_EMAIL]',
  phone: '[REDACTED_PHONE]',
  creditCard: '[REDACTED_CREDIT_CARD]',
  ssn: '[REDACTED_SSN]',
  key: '[REDACTED_PII]',
  custom: '[REDACTED_PII]',
} as const;

// Requires an '@' and a dotted domain; deliberately simple, matching the scope of
// SecretRedactionPolicy's pattern-based (not RFC 5322-exhaustive) approach.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;

// US SSN. Requires dashes to keep false positives low — a bare 9-digit run is too
// common (invoice numbers, IDs) to safely treat as a national ID by default.
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

// NANP: optionally parenthesized area code, but always at least one separator
// between groups, so a bare unformatted digit run is never misclassified as a phone number.
const NANP_PHONE_PATTERN = /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;

// Generic international format: a '+' country code followed by 2-4 grouped segments.
const INTL_PHONE_PATTERN = /\+\d{1,3}[-.\s]?\d{1,4}(?:[-.\s]\d{2,4}){1,3}\b/g;

// Candidate digit runs (13-19 digits after separators are stripped), narrowed by a
// Luhn checksum before being treated as a credit card number.
const CREDIT_CARD_CANDIDATE_PATTERN = /\b\d(?:[ -]?\d){12,18}\b/g;

/** Validates a digit string against the Luhn checksum used by major card networks. */
function isValidLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48; // '0'.charCodeAt(0)
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Built-in Output Rail policy that detects and redacts common personally identifiable
 * information — email addresses, phone numbers, credit card numbers (Luhn-validated),
 * and US Social Security Numbers — from tool output before it reaches the model
 * reasoning loop.
 *
 * Shares its traversal logic with `SecretRedactionPolicy` (`traverseAndRedact`), so
 * both policies get the same circular-reference-safe, depth-bounded object walking.
 *
 * @see Rebedea et al. (NVIDIA NeMo Guardrails, arXiv:2310.10501)
 *
 * @example
 * ```typescript
 * @Tool({ name: 'fetch_customer_record' })
 * @UsePolicies(new PiiRedactionPolicy())
 * async fetchCustomerRecord() { ... }
 * ```
 */
export class PiiRedactionPolicy implements ToolPolicy {
  private readonly redactEmail: boolean;
  private readonly redactPhone: boolean;
  private readonly redactCreditCard: boolean;
  private readonly redactSsn: boolean;
  private readonly customPatterns: RegExp[];
  private readonly sensitiveKeys: Set<string>;
  private readonly maskPlaceholder?: string;
  private readonly maxDepth: number;

  constructor(options?: PiiRedactionPolicyOptions) {
    this.redactEmail = options?.redactEmail ?? true;
    this.redactPhone = options?.redactPhone ?? true;
    this.redactCreditCard = options?.redactCreditCard ?? true;
    this.redactSsn = options?.redactSsn ?? true;
    this.customPatterns = options?.customPatterns ?? [];
    this.sensitiveKeys = new Set(options?.sensitiveKeys ?? []);
    this.maskPlaceholder = options?.maskPlaceholder;
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
   * Post-execution Output Rail hook: inspects and redacts PII from the tool output.
   */
  async evaluateOutput(
    _ctx: AgentContext,
    _toolName: string,
    result: unknown,
  ): Promise<PolicyOutputResult> {
    if (result === undefined || result === null) {
      return { decision: 'allow' };
    }

    const { value, modified } = traverseAndRedact(result, {
      maxDepth: this.maxDepth,
      transformString: (text) => this.redactString(text),
      handleKey: (key, keyValue) => {
        if (this.sensitiveKeys.has(key) && typeof keyValue === 'string') {
          return { handled: true, value: this.maskPlaceholder ?? DEFAULT_PLACEHOLDERS.key };
        }
        return { handled: false };
      },
    });

    if (modified) {
      return { decision: 'sanitize', sanitizedResult: value };
    }

    return { decision: 'allow' };
  }

  private redactString(text: string): string {
    let sanitized = text;

    if (this.redactEmail) {
      sanitized = sanitized.replace(EMAIL_PATTERN, this.maskPlaceholder ?? DEFAULT_PLACEHOLDERS.email);
    }

    if (this.redactCreditCard) {
      sanitized = sanitized.replace(CREDIT_CARD_CANDIDATE_PATTERN, (match) => {
        const digits = match.replace(/[ -]/g, '');
        if (digits.length < 13 || digits.length > 19 || !isValidLuhn(digits)) {
          return match;
        }
        return this.maskPlaceholder ?? DEFAULT_PLACEHOLDERS.creditCard;
      });
    }

    if (this.redactSsn) {
      sanitized = sanitized.replace(SSN_PATTERN, this.maskPlaceholder ?? DEFAULT_PLACEHOLDERS.ssn);
    }

    if (this.redactPhone) {
      // International (plus-prefixed) first, so a leading '+1...' number isn't
      // partially reprocessed by the NANP pattern afterward.
      sanitized = sanitized.replace(INTL_PHONE_PATTERN, this.maskPlaceholder ?? DEFAULT_PLACEHOLDERS.phone);
      sanitized = sanitized.replace(NANP_PHONE_PATTERN, this.maskPlaceholder ?? DEFAULT_PLACEHOLDERS.phone);
    }

    for (const pattern of this.customPatterns) {
      const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      sanitized = sanitized.replace(regex, this.maskPlaceholder ?? DEFAULT_PLACEHOLDERS.custom);
    }

    return sanitized;
  }
}
