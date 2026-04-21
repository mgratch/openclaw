import { describe, expect, it } from "vitest";
import {
  decideAcpxPermission,
  extractFirstAbsolutePath,
  isPathWithinRoot,
} from "./permission-policy.js";

const rwBaseline = { root: "/mnt/host-projects/foo", writable: true };
const roBaseline = { root: "/mnt/host-projects/foo", writable: false };

describe("isPathWithinRoot", () => {
  it("accepts exact match", () => {
    expect(isPathWithinRoot("/mnt/host-projects/foo", "/mnt/host-projects/foo")).toBe(true);
  });
  it("accepts descendants", () => {
    expect(isPathWithinRoot("/mnt/host-projects/foo/a/b.txt", "/mnt/host-projects/foo")).toBe(true);
  });
  it("rejects sibling with shared prefix", () => {
    expect(isPathWithinRoot("/mnt/host-projects/foo-two/x", "/mnt/host-projects/foo")).toBe(false);
  });
  it("rejects parent directory traversal", () => {
    expect(isPathWithinRoot("/mnt/host-projects", "/mnt/host-projects/foo")).toBe(false);
  });
  it("rejects unrelated absolute paths", () => {
    expect(isPathWithinRoot("/etc/passwd", "/mnt/host-projects/foo")).toBe(false);
  });
});

describe("extractFirstAbsolutePath", () => {
  it("extracts a bare path", () => {
    expect(extractFirstAbsolutePath("Read /mnt/host-projects/foo/a.txt")).toBe(
      "/mnt/host-projects/foo/a.txt",
    );
  });
  it("extracts a quoted path", () => {
    expect(extractFirstAbsolutePath('Write "/mnt/host-projects/foo/b.txt"')).toBe(
      "/mnt/host-projects/foo/b.txt",
    );
  });
  it("strips trailing punctuation", () => {
    expect(extractFirstAbsolutePath("Read /tmp/foo.txt.")).toBe("/tmp/foo.txt");
  });
  it("returns undefined for no path", () => {
    expect(extractFirstAbsolutePath("Bash")).toBeUndefined();
  });
  it("ignores relative paths", () => {
    expect(extractFirstAbsolutePath("Read ./foo.txt")).toBeUndefined();
  });
});

describe("decideAcpxPermission", () => {
  it("surfaces when there is no baseline", () => {
    const decision = decideAcpxPermission(
      { text: "...", title: "Read /mnt/host-projects/foo/a", kind: "read" },
      undefined,
    );
    expect(decision).toEqual({ action: "surface", reason: "no-baseline" });
  });

  it("auto-approves reads inside rw mount", () => {
    const decision = decideAcpxPermission(
      { text: "...", title: "Read /mnt/host-projects/foo/a", kind: "read" },
      rwBaseline,
    );
    expect(decision.action).toBe("auto-approve");
    expect(decision.reason).toBe("mount-read");
  });

  it("auto-approves writes inside rw mount", () => {
    const decision = decideAcpxPermission(
      { text: "...", title: "Write /mnt/host-projects/foo/a", kind: "write" },
      rwBaseline,
    );
    expect(decision.action).toBe("auto-approve");
    expect(decision.reason).toBe("mount-write");
  });

  it("auto-approves reads inside ro mount", () => {
    const decision = decideAcpxPermission(
      { text: "...", title: "Read /mnt/host-projects/foo/a", kind: "read" },
      roBaseline,
    );
    expect(decision.reason).toBe("mount-read");
  });

  it("surfaces writes inside ro mount", () => {
    const decision = decideAcpxPermission(
      { text: "...", title: "Write /mnt/host-projects/foo/a", kind: "write" },
      roBaseline,
    );
    expect(decision.action).toBe("surface");
    expect(decision.reason).toBe("ro-mount-write");
  });

  it("surfaces paths outside the mount", () => {
    const decision = decideAcpxPermission(
      { text: "...", title: "Read /etc/passwd", kind: "read" },
      rwBaseline,
    );
    expect(decision.reason).toBe("outside-mount");
  });

  it("always surfaces terminal command prompts", () => {
    const decision = decideAcpxPermission(
      { text: "...", title: 'terminal command "ls /mnt/host-projects/foo"' },
      rwBaseline,
    );
    expect(decision.reason).toBe("terminal-command");
  });

  it("surfaces when the title carries no path", () => {
    const decision = decideAcpxPermission(
      { text: "...", title: "Bash", kind: "bash" },
      rwBaseline,
    );
    expect(decision.reason).toBe("path-unknown");
  });
});
