---
"@nestjs-agentic/core": minor
---

Add `PiiRedactionPolicy`, a built-in Output Rail that detects and redacts email addresses, phone numbers (NANP and international), Luhn-validated credit card numbers, and US Social Security Numbers from tool output. Configurable per category, with custom patterns and sensitive-key masking (applied wholesale regardless of value type), mirroring `SecretRedactionPolicy`.

Extracted the shared circular-reference-safe object traversal into `traverseAndRedact` (`packages/core/src/utils/redaction-traversal.ts`), now used by both policies, with safer-by-default behavior: prototype-polluting keys (`__proto__`/`prototype`/`constructor`) are skipped, non-plain values (`Date`/`Map`/`Set`/class instances) are preserved instead of corrupted into plain objects, and output nested deeper than `maxDepth` is denied rather than silently passed through unexamined. `PiiRedactionPolicy` also normalizes a sticky (`y`) flag on custom patterns, which would otherwise silently skip matches not at the start of the input.

Closes #138.
