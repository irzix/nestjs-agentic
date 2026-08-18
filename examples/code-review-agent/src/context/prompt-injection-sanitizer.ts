/**
 * Sanitizes untrusted user inputs (PR titles, comments, diff content)
 * to prevent indirect prompt injection (OWASP LLM01 / Greshake et al.).
 */
export class PromptInjectionSanitizer {
  private static readonly INJECTION_PATTERNS = [
    /<\/?system>/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<<SYS>>/gi,
    /<\/SYS>/gi,
    /Human:/gi,
    /Assistant:/gi,
  ];

  /**
   * Cleans potential instruction override tokens from untrusted text.
   *
   * @param rawText Untrusted input string.
   * @returns Sanitized text with stripped delimiter injection vectors.
   */
  static sanitize(rawText: string): string {
    if (!rawText) return '';
    let sanitized = rawText;
    for (const pattern of this.INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED_DELIMITER]');
    }
    return sanitized;
  }

  /**
   * Safely wraps untrusted content inside explicit XML data boundary tags.
   *
   * @param tag XML boundary tag name.
   * @param content Untrusted text payload.
   * @returns Formatted XML boundary block.
   */
  static wrapWithBoundary(tag: string, content: string): string {
    const sanitized = this.sanitize(content);
    return `<${tag}>\n${sanitized}\n</${tag}>`;
  }
}
