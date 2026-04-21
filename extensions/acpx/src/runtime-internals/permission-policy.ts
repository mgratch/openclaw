// Mount-scoped permission policy for acpx interactive prompts.
//
// Under the user-stated policy: "default to the project's mounted folder
// permissions, but always ask for anything outside that baseline." acpx has
// no built-in path-scoped auto-approve mode, so we do the scoping here on
// top of its free-form prompt text. When a prompt arrives on the pty stream
// we decide one of:
//
//   * auto-approve  — inside the mount + allowed by mount flags
//   * auto-deny     — (reserved; policy currently never auto-denies)
//   * surface       — show an approval card to the user and wait for a click
//
// Terminal command prompts never carry structured path information in the
// title, so we always surface them: it is safer to interrupt the user than
// to silently execute a command because its string happened to start with a
// familiar prefix.

import { isAbsolute, relative, resolve } from "node:path";
import type { AcpxPermissionPromptMatch } from "./permission-prompt.js";

export type AcpxPermissionBaseline = {
  /** Absolute root path of the project's mounted folder. */
  root: string;
  /** True when the mount is read-write; false for read-only mounts. */
  writable: boolean;
};

export type AcpxPermissionPolicyDecision =
  | { action: "auto-approve"; reason: AcpxPolicyReason }
  | { action: "auto-deny"; reason: AcpxPolicyReason }
  | { action: "surface"; reason: AcpxPolicyReason };

export type AcpxPolicyReason =
  | "no-baseline"
  | "terminal-command"
  | "path-unknown"
  | "outside-mount"
  | "mount-read"
  | "mount-write"
  | "ro-mount-write";

const READ_LIKE_KINDS = new Set<string>(["read", "glob", "grep", "web_search", "web_fetch"]);

/**
 * Decide what to do with an incoming acpx permission prompt, given the
 * session's mount baseline. Returns `surface` whenever the decision is not
 * unambiguously safe under the baseline.
 */
export function decideAcpxPermission(
  match: AcpxPermissionPromptMatch,
  baseline: AcpxPermissionBaseline | undefined,
): AcpxPermissionPolicyDecision {
  if (!baseline) {
    return { action: "surface", reason: "no-baseline" };
  }

  // Terminal command prompts do not expose the paths the command will touch,
  // so we cannot prove containment. Always surface.
  if (isTerminalCommandPrompt(match)) {
    return { action: "surface", reason: "terminal-command" };
  }

  const extracted = extractFirstAbsolutePath(match.title);
  if (!extracted) {
    return { action: "surface", reason: "path-unknown" };
  }

  const within = isPathWithinRoot(extracted, baseline.root);
  if (!within) {
    return { action: "surface", reason: "outside-mount" };
  }

  const readLike = isReadLike(match.kind);
  if (readLike) {
    return { action: "auto-approve", reason: "mount-read" };
  }
  if (baseline.writable) {
    return { action: "auto-approve", reason: "mount-write" };
  }
  return { action: "surface", reason: "ro-mount-write" };
}

function isTerminalCommandPrompt(match: AcpxPermissionPromptMatch): boolean {
  // acpx renders terminal commands as:
  //   [permission] Allow terminal command "<cmd>"? (y/N)
  // and does not include a `[kind]` bracket. Match on the title prefix to
  // avoid false positives against tool titles that happen to contain
  // "terminal command".
  return !match.kind && /^terminal command\b/i.test(match.title);
}

function isReadLike(kind: string | undefined): boolean {
  if (!kind) {
    return false;
  }
  return READ_LIKE_KINDS.has(kind.toLowerCase());
}

/**
 * Extract the first absolute filesystem path that appears in the prompt
 * title, if any. acpx's title is free-form (it is whatever the inner agent
 * set on the tool call), so this is deliberately best-effort: we look for an
 * absolute path beginning with `/` that runs until whitespace or end of
 * string. Relative paths are ignored because we cannot resolve them without
 * knowing the agent's cwd at prompt time.
 */
export function extractFirstAbsolutePath(title: string): string | undefined {
  const match = /(^|[\s"'`(])(\/[^\s"'`)]+)/.exec(title);
  if (!match) {
    return undefined;
  }
  const raw = match[2];
  if (!raw || !isAbsolute(raw)) {
    return undefined;
  }
  // Strip trailing punctuation that commonly appears in prompt titles like
  // "Read /tmp/foo.txt." or "Write /tmp/foo.txt)".
  return raw.replace(/[.,;:]+$/, "");
}

/**
 * Check whether a target path is contained within a root path. Both are
 * resolved to absolute form and compared structurally to avoid prefix
 * mistakes ("/mnt/project" vs "/mnt/project-two").
 */
export function isPathWithinRoot(target: string, root: string): boolean {
  if (!isAbsolute(target) || !isAbsolute(root)) {
    return false;
  }
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget === resolvedRoot) {
    return true;
  }
  const rel = relative(resolvedRoot, resolvedTarget);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return false;
  }
  return true;
}
