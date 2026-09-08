/**
 * Type declarations for the canonicalizer shared between the migration script
 * and the TypeScript session store.
 *
 * Without these, importing the .mjs from a TypeScript test needs a
 * `@ts-expect-error` suppression — which is both fragile (a formatter can move
 * the import onto another line and orphan the directive) and wrong in spirit,
 * since this module is a real cross-language contract pinned by
 * `skill-snapshot-store.canonical-parity.test.ts`.
 */

/**
 * Deterministic JSON with sorted object keys. MUST stay byte-for-byte
 * equivalent to `canonicalJson()` in
 * `src/config/sessions/skill-snapshot-store.ts` — the two produce the SHA-256
 * that becomes a snapshot blob's file name.
 */
export function canonicalJson(value: unknown): string;

/**
 * Throws unless `value` is dense and JSON-compatible (i.e. exactly what
 * `JSON.parse()` yields). Rejects sparse arrays, non-finite numbers,
 * functions, symbols and non-plain objects, so a value whose hash would not
 * describe it can never become a content address.
 */
export function assertCanonicalizable(value: unknown, pathHint?: string): void;
