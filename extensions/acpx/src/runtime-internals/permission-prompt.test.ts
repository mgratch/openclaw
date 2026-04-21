import { describe, expect, it } from "vitest";
import {
  AcpxPermissionPromptMatcher,
  formatPermissionReply,
} from "./permission-prompt.js";

describe("AcpxPermissionPromptMatcher", () => {
  it("matches a tool-call prompt with kind", () => {
    const matcher = new AcpxPermissionPromptMatcher();
    const result = matcher.push(
      '\n[permission] Allow Read /tmp/foo.txt [read]? (y/N) ',
    );
    expect(result).toEqual({
      text: '[permission] Allow Read /tmp/foo.txt [read]? (y/N)',
      title: "Read /tmp/foo.txt",
      kind: "read",
    });
  });

  it("matches a terminal-command prompt without kind", () => {
    const matcher = new AcpxPermissionPromptMatcher();
    const result = matcher.push(
      '\n[permission] Allow terminal command "ls -la"? (y/N) ',
    );
    expect(result).toBeDefined();
    expect(result?.title).toBe('terminal command "ls -la"');
    expect(result?.kind).toBeUndefined();
  });

  it("matches across multiple chunks", () => {
    const matcher = new AcpxPermissionPromptMatcher();
    expect(matcher.push("\n[permission] Allow ")).toBeUndefined();
    expect(matcher.push("Write [write]")).toBeUndefined();
    const result = matcher.push("? (y/N) ");
    expect(result?.title).toBe("Write");
    expect(result?.kind).toBe("write");
  });

  it("ignores NDJSON lines that are not prompts", () => {
    const matcher = new AcpxPermissionPromptMatcher();
    expect(
      matcher.push('{"type":"tool_call","toolName":"Read"}\n'),
    ).toBeUndefined();
  });

  it("clears buffer after a successful match so the next prompt is fresh", () => {
    const matcher = new AcpxPermissionPromptMatcher();
    matcher.push("\n[permission] Allow Read [read]? (y/N) ");
    const second = matcher.push("\n[permission] Allow Write [write]? (y/N) ");
    expect(second?.title).toBe("Write");
    expect(second?.kind).toBe("write");
  });

  it("bounds buffer growth for pathological non-newline streams", () => {
    const matcher = new AcpxPermissionPromptMatcher();
    const big = "x".repeat(20000);
    expect(matcher.push(big)).toBeUndefined();
    // Subsequent valid prompt should still match even though we dropped the
    // giant prefix.
    const result = matcher.push("\n[permission] Allow Read [read]? (y/N) ");
    expect(result?.title).toBe("Read");
  });
});

describe("formatPermissionReply", () => {
  it("returns y\\n for allow and n\\n for deny", () => {
    expect(formatPermissionReply("allow")).toBe("y\n");
    expect(formatPermissionReply("deny")).toBe("n\n");
  });
});
