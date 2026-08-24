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
 * This is a mitigation, not a guarantee. It defends against known delimiter patterns
 * and prevents untrusted content from closing its own boundary tag, but it does not
 * neutralize arbitrary instruction-like prose, novel/encoded delimiters, or alternate
 * casing/spacing forms. Prefer provider-native structured message roles for isolating
 * untrusted data where available; treat this as defense-in-depth, not a safe channel.
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

  /** Valid XML-name-like boundary tag: a letter/underscore followed by word/dot/hyphen chars. */
  private static readonly VALID_TAG = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

  /**
   * Upper bound on input length processed by `sanitize()`. Inputs longer than this are
   * truncated before pattern matching, bounding worst-case regex cost against adversarial
   * input (including caller-supplied custom patterns) and preventing event-loop stalls.
   */
  private static readonly MAX_INPUT_LENGTH = 1_000_000;

  /**
   * Strips known injection-delimiter patterns from untrusted text.
   *
   * Custom patterns supplied via `options.patterns` are applied after the built-in
   * defaults. Because arbitrary regexes can backtrack catastrophically, input is capped
   * at a fixed length (see `MAX_INPUT_LENGTH`) to bound execution time.
   *
   * @param rawText Untrusted input string.
   * @param options Optional custom patterns/placeholder to extend or override the defaults.
   * @returns Sanitized text with matched delimiter tokens replaced.
   */
  static sanitize(rawText: string, options?: PromptInjectionSanitizerOptions): string {
    if (!rawText) return '';

    const patterns = [...this.DEFAULT_PATTERNS, ...(options?.patterns ?? [])];
    const placeholder = options?.placeholder ?? this.DEFAULT_PLACEHOLDER;

    let sanitized =
      rawText.length > this.MAX_INPUT_LENGTH ? rawText.slice(0, this.MAX_INPUT_LENGTH) : rawText;

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
   * The `tag` must be a valid XML-name-like identifier; invalid tags are rejected to
   * prevent markup injection through the tag itself. Any occurrence of the resulting
   * opening/closing markup inside the content is neutralized so untrusted content cannot
   * close or recreate the boundary.
   *
   * @param tag Boundary tag name (e.g. `'retrieved_chunk'`, `'untrusted_pr_diff'`).
   * @param content Untrusted text payload.
   * @param options Optional custom patterns/placeholder passed through to `sanitize()`.
   * @returns Formatted `<tag>\n...\n</tag>` boundary block with sanitized content.
   * @throws {Error} If `tag` is not a valid XML-name-like identifier.
   */
  static wrapWithBoundary(tag: string, content: string, options?: PromptInjectionSanitizerOptions): string {
    if (!this.VALID_TAG.test(tag)) {
      throw new Error(
        `PromptInjectionSanitizer.wrapWithBoundary: invalid boundary tag "${tag}"; expected an XML-name-like identifier.`,
      );
    }

    const sanitized = this.sanitize(content, options);
    // Neutralize the boundary markup itself so untrusted content cannot escape the tag.
    const escaped = this.escapeBoundary(tag, sanitized);
    return `<${tag}>\n${escaped}\n</${tag}>`;
  }

  /** Replaces any literal opening/closing markup for `tag` in `content` with the placeholder. */
  private static escapeBoundary(tag: string, content: string): string {
    // tag is already validated against VALID_TAG, so it contains no regex metacharacters.
    const boundary = new RegExp(`</?\\s*${tag}\\s*>`, 'gi');
    return content.replace(boundary, this.DEFAULT_PLACEHOLDER);
  }
}
