import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AcpRuntimeEvent } from "../runtime/types.js";
import {
  __resetSessionLogReaderOffsets,
  backfillFromSessionLog,
  fingerprintEvent,
} from "./session-log-reader.js";

describe("fingerprintEvent", () => {
  it("produces stable keys for hook/system/hop events", () => {
    const hook = {
      type: "hook_event",
      hookKind: "PreToolUse",
      hookName: "my-hook",
      toolCallId: "t-1",
    } as AcpRuntimeEvent;
    expect(fingerprintEvent(hook)).toBe("hook:PreToolUse:t-1:my-hook");

    const sys = {
      type: "session_system",
      kind: "session_compacted",
      text: "compacted",
    } as AcpRuntimeEvent;
    expect(fingerprintEvent(sys)).toBe("sys:session_compacted:compacted");

    const hop = {
      type: "subagent_hop",
      phase: "start",
      agentId: "a-1",
      parentToolCallId: "p-1",
    } as AcpRuntimeEvent;
    expect(fingerprintEvent(hop)).toBe("hop:start:a-1:p-1");
  });
});

describe("backfillFromSessionLog", () => {
  const origAcpxHome = process.env.ACPX_HOME;
  const origFlag = process.env.OPENCLAW_ACP_LOG_READER;
  let tmpRoot: string;

  beforeEach(() => {
    __resetSessionLogReaderOffsets();
    tmpRoot = mkdtempSync(join(tmpdir(), "openclaw-session-log-reader-"));
    mkdirSync(join(tmpRoot, "sessions"), { recursive: true });
    process.env.ACPX_HOME = tmpRoot;
    process.env.OPENCLAW_ACP_LOG_READER = "1";
  });

  afterEach(() => {
    process.env.ACPX_HOME = origAcpxHome;
    process.env.OPENCLAW_ACP_LOG_READER = origFlag;
  });

  function writeSidecar(sessionId: string, lines: object[]): string {
    const path = join(tmpRoot, "sessions", `${sessionId}.stream.ndjson`);
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return path;
  }

  it("returns null when reader is disabled", async () => {
    process.env.OPENCLAW_ACP_LOG_READER = "0";
    const result = await backfillFromSessionLog({
      acpxSessionId: "s-1",
      onEvent: () => {},
    });
    expect(result).toBeNull();
  });

  it("emits back-fillable events and skips already-seen fingerprints", async () => {
    writeSidecar("s-1", [
      {
        type: "hook_event",
        hookKind: "PostToolUse",
        hookName: "already-seen",
        toolCallId: "t-1",
      },
      {
        type: "session_system",
        kind: "session_compacted",
        text: "auto",
      },
      { type: "text_delta", text: "should not be forwarded" },
    ]);

    const seen = new Set<string>(["hook:PostToolUse:t-1:already-seen"]);
    const received: AcpRuntimeEvent[] = [];
    const result = await backfillFromSessionLog({
      acpxSessionId: "s-1",
      seenFingerprints: seen,
      onEvent: (ev) => {
        received.push(ev);
      },
    });
    expect(result?.emitted).toBe(1);
    expect(received.map((e) => e.type)).toEqual(["session_system"]);
  });

  it("only emits newly-appended lines on a second invocation", async () => {
    const path = writeSidecar("s-2", [
      { type: "session_system", kind: "auth_status", text: "ok" },
    ]);
    const first: AcpRuntimeEvent[] = [];
    await backfillFromSessionLog({
      acpxSessionId: "s-2",
      onEvent: (ev) => {
        first.push(ev);
      },
    });
    expect(first).toHaveLength(1);

    appendFileSync(
      path,
      JSON.stringify({
        type: "subagent_hop",
        phase: "start",
        agentId: "a-x",
        parentToolCallId: "p-x",
      }) + "\n",
    );

    const second: AcpRuntimeEvent[] = [];
    await backfillFromSessionLog({
      acpxSessionId: "s-2",
      onEvent: (ev) => {
        second.push(ev);
      },
    });
    expect(second).toHaveLength(1);
    expect(second[0].type).toBe("subagent_hop");
  });

  it("silently no-ops when the sidecar file is missing", async () => {
    const result = await backfillFromSessionLog({
      acpxSessionId: "does-not-exist",
      onEvent: () => {
        throw new Error("should not be called");
      },
    });
    expect(result).toBeNull();
  });
});
