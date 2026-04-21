import { describe, expect, it } from "vitest";
import {
  createWarmSessionPool,
  prepareReplay,
  renderReplayAsPrompt,
} from "./context-replay.js";

describe("prepareReplay", () => {
  it("filters empty content and unknown roles", () => {
    const payload = prepareReplay({
      sourceSessionKey: "s-1",
      targetModel: "claude-sonnet-4.6",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "   " },
        { role: "tool" as never, content: "drop me" },
        { role: "assistant", content: "hi there" },
      ],
    });
    expect(payload.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(payload.messages.map((m) => m.content)).toEqual(["hello", "hi there"]);
    expect(payload.approxChars).toBeGreaterThan(0);
  });

  it("drops oldest turns above the char cap but keeps the last message", () => {
    const longA = "A".repeat(80);
    const longB = "B".repeat(80);
    const longC = "C".repeat(80);
    const payload = prepareReplay({
      sourceSessionKey: "s-2",
      targetModel: "m",
      messages: [
        { role: "user", content: longA },
        { role: "assistant", content: longB },
        { role: "user", content: longC },
      ],
      maxChars: 170,
    });
    // Total is 240; cap is 170. Dropping A gets us to 160, which fits.
    expect(payload.messages.map((m) => m.content[0])).toEqual(["B", "C"]);
    expect(payload.approxChars).toBeLessThanOrEqual(170);
  });

  it("renderReplayAsPrompt includes prologue and role-prefixed lines", () => {
    const payload = prepareReplay({
      sourceSessionKey: "s-3",
      targetModel: "m",
      systemPrologue: "You are OpenClaw.",
      messages: [
        { role: "user", content: "ping" },
        { role: "assistant", content: "pong" },
      ],
    });
    const text = renderReplayAsPrompt(payload);
    expect(text).toContain("You are OpenClaw.");
    expect(text).toContain("[user] ping");
    expect(text).toContain("[assistant] pong");
  });
});

describe("createWarmSessionPool", () => {
  it("returns stored sessionKey within TTL", () => {
    let now = 1000;
    const pool = createWarmSessionPool({ ttlMs: 100, now: () => now });
    pool.put("m1", "sess-a");
    expect(pool.get("m1")).toBe("sess-a");
    now += 50;
    expect(pool.get("m1")).toBe("sess-a");
  });

  it("expires entries past TTL", () => {
    let now = 1000;
    const pool = createWarmSessionPool({ ttlMs: 100, now: () => now });
    pool.put("m1", "sess-a");
    now += 500;
    expect(pool.get("m1")).toBeNull();
    expect(pool.size()).toBe(0);
  });

  it("evict removes a specific model", () => {
    const pool = createWarmSessionPool();
    pool.put("m1", "sess-a");
    pool.put("m2", "sess-b");
    pool.evict("m1");
    expect(pool.get("m1")).toBeNull();
    expect(pool.get("m2")).toBe("sess-b");
  });
});
