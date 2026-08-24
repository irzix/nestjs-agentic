---
"@nestjs-agentic/core": minor
---

Add `PiiRedactionPolicy`, a built-in Output Rail that detects and redacts email addresses, phone numbers (NANP and international), Luhn-validated credit card numbers, and US Social Security Numbers from tool output. Configurable per category, with custom patterns and sensitive-key masking (applied wholesale regardless of value type), mirroring `SecretRedactionPolicy`.

Extracted the shared circular-reference-safe object traversal into `traverseAndRedact` (`packages/core/src/utils/redaction-traversal.ts`), now used by both policies, with an explicit supported boundary that fails closed outside it: strings/arrays/plain objects are rebuilt with matches redacted; `Map`/`Set` are rebuilt with keys and values redacted and **deny** if redaction would collapse two distinct entries into one; `Date`/`RegExp` are preserved as-is; class instances and platform built-ins (`URL`, `Error`, `Buffer`, typed arrays) are **inspected but never rewritten** — including symbol-keyed properties and `toJSON()` output — and **deny** when they hold sensitive data, since rebuilding them would lose internal state or trigger inherited setters; anything nested deeper than `maxDepth` is denied. Prototype-polluting keys (`__proto__`/`prototype`/`constructor`) are dropped and counted as a redaction. `PiiRedactionPolicy` validates `maxDepth` at construction and normalizes custom patterns once (stripping a sticky `y` flag that would otherwise skip matches not at the start of the input).

Closes #138.
