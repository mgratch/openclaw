// Integration tests for the acpx pty demuxer.
//
// These drive `processAcpxPtyChunk` with synthetic chunk sequences that mimic
// what acpx writes on the merged pty master stream: NDJSON event lines
// interleaved with free-form stderr and trailing `[permission] ...? (y/N)`
// prompt tails. The reducer is what decides auto-approve / auto-deny /
// surface, so the assertions target its action output directly without
// spawning a real subprocess.

import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AcpxPermissionBaseline } from "./permission-policy.js";
import {
  type AcpxPtyDemuxAction,
  createAcpxPtyDemuxState,
  processAcpxPtyChunk,
} from "./pty-demux.js";

function drive(params: {
  chunks: string[];
  baseline?: AcpxPermissionBaseline;
}): AcpxPtyDemuxAction[] {
  const state = createAcpxPtyDemuxState();
  const actions: AcpxPtyDemuxAction[] = [];
  for (const chunk of params.chunks) {
    actions.push(
      ...processAcpxPtyChunk({ chunk, state, baseline: params.baseline }),
    );
  }
  return actions;
}

describe("processAcpxPtyChunk", () => {
  const mountRoot = "/workspace/project";
  const readWriteBaseline: AcpxPermissionBaseline = {
    root: mountRoot,
    writable: true,
  };
  const readOnlyBaseline: AcpxPermissionBaseline = {
    root: mountRoot,
    writable: false,
  };

  it("extracts NDJSON events split across chunk boundaries", () => {
    const line1 = JSON.stringify({ type: "text", content: "hello " });
    const line2 = JSON.stringify({ type: "text", content: "world" });
    const actions = drive({
      chunks: [
        `${line1.slice(0, 10)}`,
        `${line1.slice(10)}\n${line2}\n`,
      ],
      baseline: readWriteBaseline,
    });
    const events = actions.filter((a) => a.kind === "event");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: "event",
      event: { type: "text_delta", text: "hello " },
    });
    expect(events[1]).toMatchObject({
      kind: "event",
      event: { type: "text_delta", text: "world" },
    });
  });

  it("maps non-JSON stderr lines to status events and skips blanks", () => {
    const done = JSON.stringify({ type: "done", stopReason: "end_turn" });
    const actions = drive({
      chunks: [`\nacpx starting...\n\n${done}\n`],
      baseline: readWriteBaseline,
    });
    expect(actions).toEqual([
      {
        kind: "event",
        event: expect.objectContaining({ type: "status", text: "acpx starting..." }),
      },
      { kind: "event", event: expect.objectContaining({ type: "done" }) },
    ]);
  });

  it("auto-approves a read prompt for a file inside a read-write mount", () => {
    const filePath = path.join(mountRoot, "src/index.ts");
    const actions = drive({
      chunks: [`\n[permission] Allow Read ${filePath} [read]? (y/N)`],
      baseline: readWriteBaseline,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "auto-reply",
      reply: "allow",
    });
    expect(actions[0].kind === "auto-reply" && actions[0].match.kind).toBe(
      "read",
    );
  });

  it("auto-approves a write prompt inside a writable mount", () => {
    const filePath = path.join(mountRoot, "src/out.ts");
    const actions = drive({
      chunks: [`\n[permission] Allow Write ${filePath} [write]? (y/N)`],
      baseline: readWriteBaseline,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "auto-reply", reply: "allow" });
  });

  it("surfaces a write prompt inside a read-only mount", () => {
    const filePath = path.join(mountRoot, "src/out.ts");
    const actions = drive({
      chunks: [`\n[permission] Allow Write ${filePath} [write]? (y/N)`],
      baseline: readOnlyBaseline,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "surface" });
    expect(actions[0].kind === "surface" && actions[0].reason).toBe(
      "ro-mount-write",
    );
  });

  it("surfaces prompts for paths outside the mount", () => {
    const actions = drive({
      chunks: [`\n[permission] Allow Read /etc/passwd [read]? (y/N)`],
      baseline: readWriteBaseline,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "surface" });
    expect(actions[0].kind === "surface" && actions[0].reason).toBe(
      "outside-mount",
    );
  });

  it("always surfaces terminal command prompts", () => {
    const actions = drive({
      chunks: [`\n[permission] Allow terminal command "rm -rf /"? (y/N)`],
      baseline: readWriteBaseline,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "surface" });
    expect(actions[0].kind === "surface" && actions[0].reason).toBe(
      "terminal-command",
    );
  });

  it("surfaces everything when no baseline is provided", () => {
    const filePath = "/anywhere/file.txt";
    const actions = drive({
      chunks: [`\n[permission] Allow Read ${filePath} [read]? (y/N)`],
      baseline: undefined,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "surface" });
    expect(actions[0].kind === "surface" && actions[0].reason).toBe(
      "no-baseline",
    );
  });

  it("emits events before surfacing a prompt that arrives in the same chunk", () => {
    const doneLine = JSON.stringify({ type: "text", content: "running" });
    const filePath = path.join(mountRoot, "secret.key");
    // A read inside the mount would normally auto-approve; use a write into a
    // read-only baseline so the decision is "surface" and ordering matters.
    const chunk = `${doneLine}\n[permission] Allow Write ${filePath} [write]? (y/N)`;
    const actions = drive({
      chunks: [chunk],
      baseline: readOnlyBaseline,
    });
    expect(actions.map((a) => a.kind)).toEqual(["event", "surface"]);
  });

  it("matches a prompt even when the tail arrives across multiple chunks", () => {
    const filePath = path.join(mountRoot, "README.md");
    const full = `\n[permission] Allow Read ${filePath} [read]? (y/N)`;
    const mid = Math.floor(full.length / 2);
    const actions = drive({
      chunks: [full.slice(0, mid), full.slice(mid)],
      baseline: readWriteBaseline,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "auto-reply", reply: "allow" });
  });

  it("does not re-match the same prompt on subsequent chunks", () => {
    const filePath = path.join(mountRoot, "src/index.ts");
    const state = createAcpxPtyDemuxState();
    const first = processAcpxPtyChunk({
      chunk: `\n[permission] Allow Read ${filePath} [read]? (y/N)`,
      state,
      baseline: readWriteBaseline,
    });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "auto-reply" });

    // After the caller writes the reply, acpx typically proceeds with more
    // NDJSON. The matcher must be empty now — a stray chunk of benign text
    // should not resurrect the prompt.
    const benign = JSON.stringify({ type: "done", stopReason: "end_turn" });
    const second = processAcpxPtyChunk({
      chunk: `${benign}\n`,
      state,
      baseline: readWriteBaseline,
    });
    expect(second).toEqual([
      { kind: "event", event: expect.objectContaining({ type: "done" }) },
    ]);
  });
});
