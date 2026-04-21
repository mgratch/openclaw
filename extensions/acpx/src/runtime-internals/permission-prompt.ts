// Parses interactive permission prompts emitted by acpx on stderr when running
// under a TTY. acpx writes prompt text via readline.question() so the prompt
// lines appear verbatim on stderr without a trailing newline, for example:
//
//   \n[permission] Allow Read [read]? (y/N)
//   \n[permission] Allow terminal command "ls -la"? (y/N)
//
// Our pty-wrapped stream merges stdout (NDJSON events) with stderr (prompt
// text). This module provides a stateful line/chunk matcher that identifies
// the tail of a prompt and extracts the human-readable title.
//
// The prompt format is documented in acpx session source at
// `[permission] Allow ${title} [${kind}]? (y/N)` — we keep the matcher loose
// enough to accept the terminal-command variant too.

const PERMISSION_PROMPT_PATTERN =
  /\[permission\] Allow (?<title>[^[(]+?)(?:\s*\[(?<kind>[^\]]+)\])?\?\s*\(y\/N\)\s*$/;

export type AcpxPermissionPromptMatch = {
  /** Raw prompt text matched, trimmed of the leading newline acpx inserts. */
  text: string;
  /** Free-form title acpx rendered, typically the tool title or command line. */
  title: string;
  /** Tool kind if acpx included one in brackets (tool-call prompts only). */
  kind?: string;
};

/**
 * Stateful matcher for acpx permission prompts over an interleaved pty stream.
 *
 * Callers feed raw chunks in order via {@link push}. When the trailing data
 * looks like a complete `(y/N)` prompt we return a match and clear the buffer;
 * otherwise we retain only the last partial line so the buffer cannot grow
 * unbounded across a long turn.
 */
export class AcpxPermissionPromptMatcher {
  private buffer = "";

  /**
   * Feed a chunk of stderr/pty data and return a match if the tail of the
   * buffer is now a complete permission prompt.
   */
  push(chunk: string): AcpxPermissionPromptMatch | undefined {
    if (!chunk) {
      return undefined;
    }
    this.buffer += chunk;
    // Prompt text never contains a newline after the `(y/N)` marker because
    // readline.question is still waiting for input. Only inspect the tail.
    const tail = this.extractTail();
    const match = PERMISSION_PROMPT_PATTERN.exec(tail);
    if (!match) {
      this.trimBuffer();
      return undefined;
    }
    const title = match.groups?.title?.trim() ?? "";
    const kind = match.groups?.kind?.trim();
    this.buffer = "";
    return {
      text: tail.trim(),
      title,
      ...(kind ? { kind } : {}),
    };
  }

  /** Drop any buffered partial line (for example after the turn ends). */
  reset(): void {
    this.buffer = "";
  }

  private extractTail(): string {
    const lastNewline = this.buffer.lastIndexOf("\n");
    if (lastNewline < 0) {
      return this.buffer;
    }
    return this.buffer.slice(lastNewline + 1);
  }

  /**
   * Bound memory use by retaining only the trailing line. Anything before the
   * last newline cannot affect the next prompt match.
   */
  private trimBuffer(): void {
    const lastNewline = this.buffer.lastIndexOf("\n");
    if (lastNewline >= 0) {
      this.buffer = this.buffer.slice(lastNewline + 1);
    }
    // Hard cap so a rogue non-newline stream can't balloon the buffer.
    if (this.buffer.length > 8192) {
      this.buffer = this.buffer.slice(-4096);
    }
  }
}

/**
 * Format the y/N reply line acpx readline expects. readline.question reads a
 * line terminated by `\n`, so we always append one.
 */
export function formatPermissionReply(decision: "allow" | "deny"): string {
  return decision === "allow" ? "y\n" : "n\n";
}
