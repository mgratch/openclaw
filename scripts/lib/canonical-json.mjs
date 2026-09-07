/**
 * Canonical JSON used to content-address skill snapshots.
 *
 * This is the single source of truth for the Node-script side. It MUST stay
 * byte-for-byte equivalent to `canonicalJson()` in
 * `src/config/sessions/skill-snapshot-store.ts`: the two implementations
 * produce the hashes that become blob file names, so any drift means a
 * snapshot migrated by the script hashes differently than the same snapshot
 * written by the gateway, and refs written by one become unresolvable by the
 * other. `skill-snapshot-store.canonical-parity.test.ts` imports this file
 * and asserts the two agree over a vector set.
 *
 * Contract: dense, JSON-compatible values only — exactly what
 * `JSON.parse()` yields. Sparse arrays, functions, symbols, BigInt, Map/Set
 * and class instances are rejected rather than silently canonicalized into
 * something whose hash does not describe the input.
 */

export function assertCanonicalizable(value, pathHint = "$") {
  if (value === null) {
    return;
  }
  const t = typeof value;
  if (t === "string" || t === "boolean") {
    return;
  }
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${pathHint}: non-finite number is not JSON-representable`);
    }
    return;
  }
  if (t !== "object") {
    throw new TypeError(`${pathHint}: ${t} is not JSON-representable`);
  }
  if (Array.isArray(value)) {
    // A sparse array serializes like a dense one filled with nulls, so its
    // hash would not distinguish `new Array(1)` from `[null]` or `[]`.
    for (let i = 0; i < value.length; i += 1) {
      if (!Object.hasOwn(value, i)) {
        throw new TypeError(`${pathHint}[${i}]: sparse arrays are not supported`);
      }
      assertCanonicalizable(value[i], `${pathHint}[${i}]`);
    }
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`${pathHint}: only plain objects are supported`);
  }
  for (const [k, v] of Object.entries(value)) {
    assertCanonicalizable(v, `${pathHint}.${k}`);
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
