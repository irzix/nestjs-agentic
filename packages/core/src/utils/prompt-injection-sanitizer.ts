/** Options for configuring PromptInjectionSanitizer pattern matching. */
export interface PromptInjectionSanitizerOptions {
  /** Additional regex patterns to strip, appended to the built-in defaults. */
  patterns?: RegExp[];

  /** Replacement string for matched delimiters. Default: `'[REDACTED_DELIMITER]'` */
  placeholder?: string;
}

/**
 * Strips known chat-template and role-delimiter injection vectors from untrusted text,
 * and wraps untrusted content in explicit XML-style boundary tags so it cannot be
 * mistaken for framework/system instructions once spliced into a prompt.
 *
 * This is a mitigation, not a guarantee: a sufficiently novel injection payload that
 * doesn't match a known delimiter pattern will still pass through. Boundary wrapping
 * helps the model distinguish "instructions" from "data", but does not prevent every
 * form of instruction-following on untrusted content.
 *
 * @see Greshake et al., "Not what you've signed up for: Compromising Real-World
 *      LLM-Integrated Applications with Indirect Prompt Injection" (USENIX Security 2023, arXiv:2302.12173)
 *
 * @example
 * ```typescript
 * const safe = PromptInjectionSanitizer.wrapWithBoundary('retrieved_chunk', chunk.content);
 * ```
 */
export class PromptInjectionSanitizer {
  private static readonly DEFAULT_PATTERNS: RegExp[] = [
    /<\/?system>/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<<SYS>>/gi,
    /<\/SYS>/gi,
    /^\s*Human:/gim,
    /^\s*Assistant:/gim,
    /^\s*System:/gim,
  ];

  private static readonly DEFAULT_PLACEHOLDER = '[REDACTED_DELIMITER]';

  /**
   * Strips known injection-delimiter patterns from untrusted text.
   *
   * @param rawText Untrusted input string.
   * @param options Optional custom patterns/placeholder to extend or override the defaults.
   * @returns Sanitized text with matched delimiter tokens replaced.
   */
  static sanitize(rawText: string, options?: PromptInjectionSanitizerOptions): string {
    if (!rawText) return '';

    const patterns = [...this.DEFAULT_PATTERNS, ...(options?.patterns ?? [])];
    const placeholder = options?.placeholder ?? this.DEFAULT_PLACEHOLDER;

    let sanitized = rawText;
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      sanitized = sanitized.replace(regex, placeholder);
    }
    return sanitized;
  }

  /**
   * Sanitizes and wraps untrusted content inside an explicit boundary tag, so downstream
   * prompt assembly can visibly distinguish it from trusted instructions.
   *
   * @param tag Boundary tag name (e.g. `'retrieved_chunk'`, `'untrusted_pr_diff'`).
   * @param content Untrusted text payload.
   * @param options Optional custom patterns/placeholder passed through to `sanitize()`.
   * @returns Formatted `<tag>\n...\n</tag>` boundary block with sanitized content.
   */
  static wrapWithBoundary(tag: string, content: string, options?: PromptInjectionSanitizerOptions): string {
    const sanitized = this.sanitize(content, options);
    return `<${tag}>\n${sanitized}\n</${tag}>`;
  }
}
