import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUT_FILE_MIMES,
  extractFileContentFromSource,
  type InputFileLimits,
  mimeListAllowsAll,
  resolveInputFileLimits,
} from "./input-files.js";

function limits(overrides?: Partial<InputFileLimits>): InputFileLimits {
  return {
    ...resolveInputFileLimits({ allowedMimes: ["*/*"], maxBytes: 4096, maxChars: 1000 }),
    ...overrides,
  };
}

function base64(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input, "utf8") : input).toString("base64");
}

describe("mimeListAllowsAll", () => {
  it("recognizes explicit wildcards in either form", () => {
    expect(mimeListAllowsAll(["*/*"])).toBe(true);
    expect(mimeListAllowsAll(["*"])).toBe(true);
    expect(mimeListAllowsAll(["text/plain", "*/*"])).toBe(true);
    // Case and parameter normalization runs first.
    expect(mimeListAllowsAll(["*/*; charset=utf-8"])).toBe(true);
  });

  it("never infers allow-all from an absent or empty list", () => {
    // Important: an empty list means "use the built-in defaults", so the
    // defaults must not be able to promote themselves to allow-all.
    expect(mimeListAllowsAll(undefined)).toBe(false);
    expect(mimeListAllowsAll([])).toBe(false);
    expect(mimeListAllowsAll(DEFAULT_INPUT_FILE_MIMES)).toBe(false);
    expect(mimeListAllowsAll(["text/plain"])).toBe(false);
    // A wildcard subtype is not a wildcard: it is simply an unknown type.
    expect(mimeListAllowsAll(["text/*"])).toBe(false);
  });

  it("is reflected on the resolved limits", () => {
    expect(resolveInputFileLimits({ allowedMimes: ["*/*"] }).allowAllMimes).toBe(true);
    expect(resolveInputFileLimits({ allowedMimes: ["text/plain"] }).allowAllMimes).toBe(false);
    expect(resolveInputFileLimits().allowAllMimes).toBe(false);
  });
});

describe("input_file extraction with allowAllMimes", () => {
  it("accepts a type that is not in the allowlist", async () => {
    const result = await extractFileContentFromSource({
      source: {
        type: "base64",
        data: base64("print('hi')\n"),
        mediaType: "text/x-python",
        filename: "hello.py",
      },
      limits: limits(),
    });
    expect(result.text).toBe("print('hi')\n");
    expect(result.filename).toBe("hello.py");
  });

  it("accepts a file with no declared media type", async () => {
    const result = await extractFileContentFromSource({
      source: { type: "base64", data: base64("plain words"), filename: "notes" },
      limits: limits(),
    });
    expect(result.text).toBe("plain words");
  });

  it("still rejects unknown types when the wildcard is absent", async () => {
    await expect(
      extractFileContentFromSource({
        source: {
          type: "base64",
          data: base64("print('hi')"),
          mediaType: "text/x-python",
          filename: "hello.py",
        },
        limits: resolveInputFileLimits({ allowedMimes: ["text/plain"] }),
      }),
    ).rejects.toThrow(/Unsupported file MIME type/);
  });

  it("still enforces maxBytes, so allow-all is not allow-unbounded", async () => {
    await expect(
      extractFileContentFromSource({
        source: {
          type: "base64",
          data: base64("x".repeat(64)),
          mediaType: "application/octet-stream",
          filename: "big.bin",
        },
        limits: limits({ maxBytes: 8 }),
      }),
    ).rejects.toThrow(/too large/i);
  });
});

describe("binary content fallback", () => {
  it("summarizes binary payloads instead of emitting replacement characters", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]);
    const result = await extractFileContentFromSource({
      source: {
        type: "base64",
        data: base64(png),
        mediaType: "image/png",
        filename: "logo.png",
      },
      limits: limits(),
    });
    expect(result.text).toBe(
      `[binary file: image/png, ${png.byteLength} bytes, no text extracted]`,
    );
    expect(result.text).not.toContain("�");
  });

  it("labels an undeclared binary as octet-stream", async () => {
    const blob = Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x02, 0x03]);
    const result = await extractFileContentFromSource({
      source: { type: "base64", data: base64(blob), filename: "mystery" },
      limits: limits(),
    });
    expect(result.text).toContain("[binary file: application/octet-stream,");
  });

  it("does not misclassify UTF-16 text, whose NUL bytes are legitimate", async () => {
    const utf16 = Buffer.from("hello world", "utf16le");
    const result = await extractFileContentFromSource({
      source: {
        type: "base64",
        data: base64(utf16),
        mediaType: "text/plain; charset=utf-16le",
        filename: "wide.txt",
      },
      limits: limits(),
    });
    expect(result.text).toBe("hello world");
  });

  it("does not misread short legacy-encoded text as binary", async () => {
    // Regression: cp1252 smart quotes decode to U+FFFD under UTF-8, and in a
    // 9-byte file two of them clear any low replacement ratio. Short inputs
    // must rely on the NUL check alone, or real prose gets thrown away.
    const cp1252 = Buffer.from([0x48, 0x69, 0x20, 0x93, 0x74, 0x68, 0x65, 0x72, 0x94]);
    const result = await extractFileContentFromSource({
      source: {
        type: "base64",
        data: base64(cp1252),
        mediaType: "text/plain",
        filename: "legacy.txt",
      },
      limits: limits(),
    });
    expect(result.text).toContain("Hi");
    expect(result.text).not.toContain("[binary file");
  });

  it("still flags a long binary payload that has no NUL bytes", async () => {
    // The ratio test must survive: 0x80-0xff with no NULs is invalid UTF-8 and
    // long enough to trust.
    const blob = Buffer.from(Array.from({ length: 512 }, (_, i) => 0x80 + (i % 0x7f)));
    const result = await extractFileContentFromSource({
      source: { type: "base64", data: base64(blob), mediaType: "application/x-thing" },
      limits: limits(),
    });
    expect(result.text).toContain("[binary file: application/x-thing,");
  });

  it("keeps ordinary UTF-8 text intact", async () => {
    const text = "line one\nline two\nunicode: café 🎉\n";
    const result = await extractFileContentFromSource({
      source: {
        type: "base64",
        data: base64(text),
        mediaType: "text/plain",
        filename: "notes.txt",
      },
      limits: limits(),
    });
    expect(result.text).toBe(text);
  });
});
