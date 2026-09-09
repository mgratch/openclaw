import { beforeAll, describe, expect, it, vi } from "vitest";

// This file mocks nothing, but the unit surface runs with isolate:false, so a
// sibling that hoists mocks over pi-tools' dependency graph (plugins/tools.js,
// exec-approvals, ...) leaves a poisoned copy in the shared module registry and
// this file inherits it. Reset and import lazily so it always exercises the
// real graph regardless of who ran first.
let createOpenClawCodingTools: typeof import("./pi-tools.js").createOpenClawCodingTools;

beforeAll(async () => {
  vi.resetModules();
  ({ createOpenClawCodingTools } = await import("./pi-tools.js"));
});

describe("createOpenClawCodingTools message provider policy", () => {
  it.each(["voice", "VOICE", " Voice "])(
    "does not expose tts tool for normalized voice provider: %s",
    (messageProvider) => {
      const tools = createOpenClawCodingTools({ messageProvider });
      const names = new Set(tools.map((tool) => tool.name));
      expect(names.has("tts")).toBe(false);
    },
  );

  it("keeps tts tool for non-voice providers", () => {
    const tools = createOpenClawCodingTools({ messageProvider: "discord" });
    const names = new Set(tools.map((tool) => tool.name));
    expect(names.has("tts")).toBe(true);
  });
});
