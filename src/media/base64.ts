export function estimateBase64DecodedBytes(base64: string): number {
  // Avoid `trim()`/`replace()` here: they allocate a second (potentially huge) string.
  // We only need a conservative decoded-size estimate to enforce budgets before Buffer.from(..., "base64").
  let effectiveLen = 0;
  for (let i = 0; i < base64.length; i += 1) {
    const code = base64.charCodeAt(i);
    // Treat ASCII control + space as whitespace; base64 decoders commonly ignore these.
    if (code <= 0x20) {
      continue;
    }
    effectiveLen += 1;
  }

  if (effectiveLen === 0) {
    return 0;
  }

  let padding = 0;
  // Find last non-whitespace char(s) to detect '=' padding without allocating/copying.
  let end = base64.length - 1;
  while (end >= 0 && base64.charCodeAt(end) <= 0x20) {
    end -= 1;
  }
  if (end >= 0 && base64[end] === "=") {
    padding = 1;
    end -= 1;
    while (end >= 0 && base64.charCodeAt(end) <= 0x20) {
      end -= 1;
    }
    if (end >= 0 && base64[end] === "=") {
      padding = 2;
    }
  }

  const estimated = Math.floor((effectiveLen * 3) / 4) - padding;
  return Math.max(0, estimated);
}

/**
 * Iterative, no-engine-stack base64-charset validator.
 *
 * 2026-04-29: replaced the previous `/^[A-Za-z0-9+/]+={0,2}$/.test(value)`
 * regex (BASE64_CHARS_RE) with this character scan. The regex looks
 * O(n) but V8's RegExp engine pushes internal quantifier-unwinding state
 * onto the call stack for `+` and `={0,2}` patterns; large enough inputs
 * (~10 MB+) overflow before completing. Reproduced via openresponses
 * `[openresponses] request parsing failed: RangeError: Maximum call stack
 * size exceeded` on a 12-image upload, with the recursing site located in
 * canonicalizeBase64() → BASE64_CHARS_RE.test().
 *
 * Twin of the same fix in src/gateway/chat-attachments.ts:isValidBase64.
 */
function isBase64Charset(cleaned: string): boolean {
  let padCount = 0;
  let nonPadCount = 0;
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned.charCodeAt(i);
    if (padCount > 0) {
      if (ch !== 0x3d /* '=' */) return false;
      padCount += 1;
      if (padCount > 2) return false;
      continue;
    }
    if (ch === 0x3d /* '=' */) { padCount = 1; continue; }
    // A-Z, a-z, 0-9, '+', '/'
    if (
      (ch >= 0x41 && ch <= 0x5a) ||
      (ch >= 0x61 && ch <= 0x7a) ||
      (ch >= 0x30 && ch <= 0x39) ||
      ch === 0x2b ||
      ch === 0x2f
    ) {
      nonPadCount += 1;
      continue;
    }
    return false;
  }
  return nonPadCount > 0;
}

/**
 * Normalize and validate a base64 string.
 * Returns canonical base64 (no whitespace) or undefined when invalid.
 */
export function canonicalizeBase64(base64: string): string | undefined {
  const cleaned = base64.replace(/\s+/g, "");
  if (!cleaned || cleaned.length % 4 !== 0 || !isBase64Charset(cleaned)) {
    return undefined;
  }
  return cleaned;
}
