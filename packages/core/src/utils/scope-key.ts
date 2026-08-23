/**
 * Builds a collision-free composite key from an ordered list of scope
 * segments (e.g. tenant id, session id, agent name).
 *
 * Plain concatenation like `${a}:${b}` is ambiguous when either segment can
 * contain the delimiter: `a="x"` + `b="y:z"` collides with `a="x:y"` +
 * `b="z"`. JSON-encoding the tuple avoids that, since two different segment
 * lists can never serialize to the same JSON array. `undefined` segments
 * (e.g. no tenant on the context) are normalized to `null` so "absent" is
 * distinguished from a segment literally equal to any string value.
 */
export function scopeKey(...parts: Array<string | number | undefined>): string {
  return JSON.stringify(parts.map((p) => p ?? null));
}
