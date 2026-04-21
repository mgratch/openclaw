import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { writePromptToTempFile } from "./prompt-tempfile.js";

describe("writePromptToTempFile", () => {
  it("writes the text to a readable path and cleans up", async () => {
    const file = await writePromptToTempFile("hello prompt");
    const contents = await readFile(file.path, "utf8");
    expect(contents).toBe("hello prompt");
    const st = await stat(file.path);
    expect(st.isFile()).toBe(true);
    await file.cleanup();
    await expect(stat(file.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleanup is idempotent", async () => {
    const file = await writePromptToTempFile("idempotent");
    await file.cleanup();
    await expect(file.cleanup()).resolves.toBeUndefined();
  });

  it("writes file with 0600 mode on POSIX", async () => {
    if (process.platform === "win32") {
      return;
    }
    const file = await writePromptToTempFile("mode check");
    try {
      const st = await stat(file.path);
      // eslint-disable-next-line no-bitwise
      expect(st.mode & 0o777).toBe(0o600);
    } finally {
      await file.cleanup();
    }
  });
});
