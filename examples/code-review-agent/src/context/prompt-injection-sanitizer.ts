/**
 * @deprecated Promoted to `@nestjs-agentic/core` as `PromptInjectionSanitizer`.
 * Re-exported here for backward compatibility with existing imports in this example.
 *
 * Note: the promoted version matches `Human:`/`Assistant:`/`System:` role markers only
 * at the start of a line (anchored), not inline, to reduce false positives on benign
 * prose. Delimiter tokens (`[INST]`, `<|im_start|>`, `<system>`, etc.) are matched
 * anywhere, as before.
 */
export { PromptInjectionSanitizer } from 'nestjs-agentic';
