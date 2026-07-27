// Redaction filter for the upgrade-contracts harness.
//
// The harness must never serialize plaintext secrets, tokens, credentials, env
// values, or config values that could leak Marc's identities. Every value that
// enters the JSON/Markdown report first passes through `redact()`.
//
// Rules — deliberately conservative:
//   * object keys whose lowercased form matches a sensitive pattern become a
//     `<redacted:key>` sentinel regardless of the value shape;
//   * strings are pattern-matched against known token prefixes and structured
//     credential shapes (bearer/basic, JWT, PEM, sk-, ghp_, xoxb-, AWS, gcp,
//     JSON-embedded key=value tokens, URL query secrets);
//   * strings are also matched against generic high-entropy blob patterns and
//     PII shapes (emails, E.164/US-style phone numbers);
//   * absolute host paths (including inside stack frames, notes, and free-form
//     text) are collapsed to a trailing segment so they cannot leak identity;
//   * cycles are broken so the harness cannot hang on a self-referential
//     evidence blob;
//   * useful relative evidence (repo-relative paths, matrix ids, commit SHAs)
//     is preserved.
//
// Redaction is intentionally strict — it prefers over-redaction to leaking a
// secret. Add an explicit ALLOWED_KEYS entry only with a justification.

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /api[_-]?key/i,
  /^auth$/i,
  /authorization/i,
  /credential/i,
  /oauth/i,
  /jwt/i,
  /session[_-]?id/i,
  /cookie/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
  /bearer/i,
  /^env$/i,
  /^shellEnv$/i,
  /^headers$/i,
];

// Allow-list of keys that always pass through even if they match a pattern.
// (Empty on purpose — extend explicitly with justification.)
const ALLOWED_KEYS = new Set();

// Ordered so more-specific patterns run first.
const SENSITIVE_VALUE_PATTERNS = [
  { name: "pem", rx: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/ },
  {
    name: "openssh",
    rx: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/,
  },
  { name: "jwt", rx: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: "openai-sk", rx: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/ },
  { name: "github-pat", rx: /\bgh[opsu]_[A-Za-z0-9]{20,}\b/ },
  { name: "slack", rx: /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/ },
  { name: "aws-akid", rx: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "gcp-api-key", rx: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "bearer", rx: /\bBearer\s+[A-Za-z0-9._\-+/]{16,}={0,3}\b/i },
  { name: "basic", rx: /\bBasic\s+[A-Za-z0-9+/]{16,}={0,3}\b/i },
];

// A blob is high-entropy if it looks like base64/hex, is long, and does not
// look like an English sentence. Kept separate so we can whitelist matrix ids
// and commit SHAs, which are short-ish uppercase-friendly tokens.
const HIGH_ENTROPY_TOKEN = /(?<![A-Za-z0-9])[A-Za-z0-9+/_-]{40,}={0,3}(?![A-Za-z0-9])/g;
// Full Git commit SHAs and SHA-256 checksums are legitimate evidence. Match
// only the exact 40/64-hex forms; shorter IDs are safe in prose, while other
// arbitrary hex lengths should not receive a blanket exemption.
const EVIDENCE_HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// URL query parameter secrets — token=..., access_token=..., password=..., etc.
const URL_SECRET =
  /\b(?:token|access_token|refresh_token|api[_-]?key|password|passwd|secret|code|state|nonce|jwt|sig|signature|hmac)=([^\s&#'"<>]{4,})/gi;

// Absolute host paths that leak identity. Includes inside stack frames and any
// free text. We keep the trailing two path segments as evidence hint.
const HOST_PATH_PATTERNS = [
  /\/Users\/[^\s"'`)<>]+/g,
  /\/home\/[^\s"'`)<>/]+\/[^\s"'`)<>]+/g,
  /\/private\/var\/folders\/[^\s"'`)<>]+/g,
  /\/tmp\/[A-Za-z0-9_.-]+\/[^\s"'`)<>]+/g,
  /\/mnt\/host-projects\/[^\s"'`)<>]+/g,
];

// Contact PII — free-form. We do not attempt to preserve any of it because
// operator identity is not evidence for the upgrade gate.
const EMAIL_RX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RX = /(?:(?<!\d)\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)/g;

const SENSITIVE_CLASSIFIER = "redacted";
const PATH_CLASSIFIER = "redacted-path";

export function isSensitiveKey(key) {
  if (typeof key !== "string") {
    return false;
  }
  if (ALLOWED_KEYS.has(key)) {
    return false;
  }
  return SENSITIVE_KEY_PATTERNS.some((rx) => rx.test(key));
}

function collapsePath(match) {
  const parts = match.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  return `<${PATH_CLASSIFIER}:.../${tail}>`;
}

function scrubStrings(str) {
  let out = str;
  // Sensitive tokens with known structure first. These full-match — if the
  // whole string is a token, return the sentinel.
  for (const { name, rx } of SENSITIVE_VALUE_PATTERNS) {
    if (rx.test(out)) {
      // Replace all occurrences of the concrete token within the string; keep
      // surrounding context (like note bodies) intact.
      out = out.replace(
        new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : rx.flags + "g"),
        `<${SENSITIVE_CLASSIFIER}:${name}>`,
      );
    }
  }
  // URL query secrets.
  out = out.replace(URL_SECRET, (m, val) => m.replace(val, `<${SENSITIVE_CLASSIFIER}:url-secret>`));
  // Emails and phones.
  out = out.replace(EMAIL_RX, `<${SENSITIVE_CLASSIFIER}:email>`);
  out = out.replace(PHONE_RX, `<${SENSITIVE_CLASSIFIER}:phone>`);
  // Absolute host paths anywhere in the string.
  for (const rx of HOST_PATH_PATTERNS) {
    out = out.replace(rx, collapsePath);
  }
  // High-entropy blobs that are NOT commit SHAs.
  out = out.replace(HIGH_ENTROPY_TOKEN, (m) =>
    EVIDENCE_HEX.test(m) ? m : `<${SENSITIVE_CLASSIFIER}:entropy>`,
  );
  return out;
}

function redactString(value) {
  if (typeof value !== "string") {
    return value;
  }
  if (value.length === 0) {
    return value;
  }
  // Preserve exact evidence hashes before the phone scrubber sees long
  // digit-only runs inside an otherwise valid hexadecimal digest.
  if (EVIDENCE_HEX.test(value)) {
    return value;
  }
  return scrubStrings(value);
}

function redactError(err) {
  const message = redactString(String(err?.message ?? err ?? ""));
  const stack =
    typeof err?.stack === "string"
      ? redactString(err.stack.split("\n").slice(0, 8).join("\n"))
      : undefined;
  return { name: err?.name ?? "Error", message, stack };
}

export function redact(input, seen = new WeakSet()) {
  if (input === null || input === undefined) {
    return input;
  }
  if (typeof input === "string") {
    return redactString(input);
  }
  if (typeof input === "number" || typeof input === "boolean" || typeof input === "bigint") {
    return input;
  }
  if (input instanceof Error) {
    return redactError(input);
  }
  if (Array.isArray(input)) {
    if (seen.has(input)) {
      return `<${SENSITIVE_CLASSIFIER}:cycle>`;
    }
    seen.add(input);
    return input.map((v) => redact(v, seen));
  }
  if (typeof input === "object") {
    if (seen.has(input)) {
      return `<${SENSITIVE_CLASSIFIER}:cycle>`;
    }
    seen.add(input);
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (isSensitiveKey(k)) {
        out[k] = `<${SENSITIVE_CLASSIFIER}:key>`;
      } else {
        out[k] = redact(v, seen);
      }
    }
    return out;
  }
  return `<${SENSITIVE_CLASSIFIER}:non-serializable>`;
}
