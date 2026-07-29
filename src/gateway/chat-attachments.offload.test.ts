// Focused offload behavior for parseMessageWithAttachments.
//
// This suite documents the *actual* production semantics of the 2026.4.2
// parser as observed in src/gateway/chat-attachments.ts:
//
//   * Only SUPPORTED image formats are offloaded to the media store when they
//     exceed OFFLOAD_THRESHOLD_BYTES (2,000,000 decoded bytes).
//   * Non-image content is silently dropped by the parser (a warning is
//     logged) — non-image offload is NOT implemented in this version.
//   * Oversized-but-unsupported image formats (bmp/tiff) are rejected before
//     the media store is touched.
//   * saveMediaBuffer/deleteMediaBuffer live behind seams so the tests never
//     write to disk. We mock them via vi.hoisted so the parser sees stable
//     spies even on module re-imports.
//   * Real MIME sniffing is intentionally preserved — the giant JPEG payload
//     is a real JPEG buffer generated at runtime with `sharp`, never a
//     hard-coded binary literal.

import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveMediaBufferMock = vi.hoisted(() => vi.fn());
const deleteMediaBufferMock = vi.hoisted(() => vi.fn());

vi.mock("../media/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../media/store.js")>();
  return {
    ...actual,
    saveMediaBuffer: (...args: unknown[]) => saveMediaBufferMock(...args),
    deleteMediaBuffer: (...args: unknown[]) => deleteMediaBufferMock(...args),
  };
});

import { MediaOffloadError, parseMessageWithAttachments } from "./chat-attachments.js";

const OFFLOAD_THRESHOLD_BYTES = 2_000_000;
const SMALL_PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

// Cache the big JPEG so we only pay the compression cost once per test file.
let cachedLargeJpegBase64: string | null = null;

function fillDeterministicNoise(buffer: Buffer): void {
  // Fixed xorshift32 stream: incompressible enough for the size boundary while
  // keeping this preservation test byte-for-byte reproducible.
  let state = 0x6d2b79f5;
  for (let i = 0; i < buffer.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    buffer[i] = state & 0xff;
  }
}

async function largeJpegBase64(): Promise<string> {
  if (cachedLargeJpegBase64) {
    return cachedLargeJpegBase64;
  }
  // Deterministic noise defeats JPEG entropy coding so the encoded output is
  // guaranteed to exceed the offload threshold.
  const width = 1400;
  const height = 1400;
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  fillDeterministicNoise(raw);
  const jpeg = await sharp(raw, { raw: { width, height, channels } })
    .jpeg({ quality: 100 })
    .toBuffer();
  if (jpeg.byteLength <= OFFLOAD_THRESHOLD_BYTES) {
    throw new Error(
      `test fixture regression: generated JPEG is ${jpeg.byteLength} bytes, needs > ${OFFLOAD_THRESHOLD_BYTES}`,
    );
  }
  cachedLargeJpegBase64 = jpeg.toString("base64");
  return cachedLargeJpegBase64;
}

function collectLogs(): { warn: (msg: string) => void; warnings: string[] } {
  const warnings: string[] = [];
  return {
    warn: (msg: string) => warnings.push(msg),
    warnings,
  };
}

beforeEach(() => {
  saveMediaBufferMock.mockReset();
  deleteMediaBufferMock.mockReset();
});

describe("parseMessageWithAttachments offload behavior", () => {
  it("offloads a supported large image to a structured ref + media marker, excluded from inline images", async () => {
    const bigJpg = await largeJpegBase64();
    const savedPath = "/opt/openclaw/media/inbound/photo---abc.jpg";
    saveMediaBufferMock.mockResolvedValueOnce({ id: "photo---abc.jpg", path: savedPath });

    const log = collectLogs();
    const parsed = await parseMessageWithAttachments(
      "before",
      [
        {
          type: "image",
          mimeType: "image/jpeg",
          fileName: "photo.jpg",
          content: bigJpg,
        },
      ],
      { log },
    );

    expect(saveMediaBufferMock).toHaveBeenCalledTimes(1);
    expect(deleteMediaBufferMock).not.toHaveBeenCalled();
    expect(parsed.images).toHaveLength(0);
    expect(parsed.offloadedRefs).toHaveLength(1);
    const ref = parsed.offloadedRefs[0];
    expect(ref).toBeDefined();
    expect(ref?.mediaRef).toBe("media://inbound/photo---abc.jpg");
    expect(ref?.id).toBe("photo---abc.jpg");
    expect(ref?.path).toBe(savedPath);
    expect(ref?.mimeType).toBe("image/jpeg");
    expect(ref?.label).toBe("photo.jpg");
    expect(parsed.imageOrder).toEqual(["offloaded"]);
    expect(parsed.message).toContain("media://inbound/photo---abc.jpg");
    // The absolute filesystem path returned by saveMediaBuffer must NOT be
    // injected into the message body — only the opaque media:// URI is
    // allowed to reach the model.
    expect(parsed.message).not.toContain(savedPath);
  });

  it("preserves imageOrder across a mixed inline/offloaded batch", async () => {
    const bigJpg = await largeJpegBase64();
    saveMediaBufferMock.mockResolvedValueOnce({
      id: "big---1.jpg",
      path: "/opt/media/big---1.jpg",
    });

    const log = collectLogs();
    const parsed = await parseMessageWithAttachments(
      "mixed",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "small.png",
          content: SMALL_PNG_1x1,
        },
        {
          type: "image",
          mimeType: "image/jpeg",
          fileName: "large.jpg",
          content: bigJpg,
        },
      ],
      { log },
    );

    expect(parsed.imageOrder).toEqual(["inline", "offloaded"]);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.offloadedRefs).toHaveLength(1);
    expect(parsed.offloadedRefs[0]?.id).toBe("big---1.jpg");
    expect(parsed.message).toContain("media://inbound/big---1.jpg");
  });

  it("drops every attachment when supportsImages=false without touching the media store", async () => {
    const bigJpg = await largeJpegBase64();
    const log = collectLogs();
    const parsed = await parseMessageWithAttachments(
      "text-only",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "small.png",
          content: SMALL_PNG_1x1,
        },
        {
          type: "image",
          mimeType: "image/jpeg",
          fileName: "large.jpg",
          content: bigJpg,
        },
      ],
      { log, supportsImages: false },
    );

    expect(saveMediaBufferMock).not.toHaveBeenCalled();
    expect(deleteMediaBufferMock).not.toHaveBeenCalled();
    expect(parsed.images).toHaveLength(0);
    expect(parsed.offloadedRefs).toHaveLength(0);
    expect(parsed.imageOrder).toHaveLength(0);
    expect(parsed.message).toBe("text-only");
    expect(log.warnings.some((w) => /model does not support images/i.test(w))).toBe(true);
  });

  it("rejects an oversized image format that is not supported for offload before hitting the media store", async () => {
    // Real BMP magic bytes ("BM") + noise so the sniffer classifies this as
    // image/bmp. image/bmp is intentionally absent from SUPPORTED_OFFLOAD_MIMES
    // (see the extension-loss note in chat-attachments.ts), so this MUST throw
    // with a "too large to pass inline" message and the media store MUST be
    // untouched.
    const bmpHeader = Buffer.from([0x42, 0x4d]);
    const bmpBody = Buffer.alloc(OFFLOAD_THRESHOLD_BYTES + 4096);
    const bmpBase64 = Buffer.concat([bmpHeader, bmpBody]).toString("base64");

    const rejection = parseMessageWithAttachments(
      "x",
      [
        {
          type: "image",
          mimeType: "image/bmp",
          fileName: "large.bmp",
          content: bmpBase64,
        },
      ],
      { log: collectLogs() },
    );
    await expect(rejection).rejects.toThrow(/too large to pass inline/i);
    await expect(rejection).rejects.not.toBeInstanceOf(MediaOffloadError);

    expect(saveMediaBufferMock).not.toHaveBeenCalled();
    expect(deleteMediaBufferMock).not.toHaveBeenCalled();
  });

  it("wraps an empty saved media ID as a MediaOffloadError", async () => {
    const bigJpg = await largeJpegBase64();
    saveMediaBufferMock.mockResolvedValueOnce({ id: "", path: "/opt/media/blank" });

    await expect(
      parseMessageWithAttachments(
        "x",
        [{ type: "image", mimeType: "image/jpeg", fileName: "photo.jpg", content: bigJpg }],
        { log: collectLogs() },
      ),
    ).rejects.toBeInstanceOf(MediaOffloadError);
  });

  it("wraps an unsafe saved media ID (contains path separators) as a MediaOffloadError", async () => {
    const bigJpg = await largeJpegBase64();
    saveMediaBufferMock.mockResolvedValueOnce({
      id: "../escape/photo.jpg",
      path: "/opt/media/../escape/photo.jpg",
    });

    await expect(
      parseMessageWithAttachments(
        "x",
        [{ type: "image", mimeType: "image/jpeg", fileName: "photo.jpg", content: bigJpg }],
        { log: collectLogs() },
      ),
    ).rejects.toBeInstanceOf(MediaOffloadError);
  });

  it("deletes previously saved offload IDs when a later attachment fails", async () => {
    const bigJpg = await largeJpegBase64();
    saveMediaBufferMock.mockResolvedValueOnce({
      id: "first---ok.jpg",
      path: "/opt/media/first---ok.jpg",
    });
    saveMediaBufferMock.mockRejectedValueOnce(new Error("disk full"));
    deleteMediaBufferMock.mockResolvedValue(undefined);

    await expect(
      parseMessageWithAttachments(
        "x",
        [
          { type: "image", mimeType: "image/jpeg", fileName: "a.jpg", content: bigJpg },
          { type: "image", mimeType: "image/jpeg", fileName: "b.jpg", content: bigJpg },
        ],
        { log: collectLogs() },
      ),
    ).rejects.toBeInstanceOf(MediaOffloadError);

    expect(deleteMediaBufferMock).toHaveBeenCalledTimes(1);
    expect(deleteMediaBufferMock).toHaveBeenCalledWith("first---ok.jpg", "inbound");
  });

  it("classifies a storage failure as MediaOffloadError but input-validation failures as ordinary Error", async () => {
    const bigJpg = await largeJpegBase64();
    saveMediaBufferMock.mockRejectedValueOnce(new Error("ENOSPC"));

    await expect(
      parseMessageWithAttachments(
        "x",
        [{ type: "image", mimeType: "image/jpeg", fileName: "photo.jpg", content: bigJpg }],
        { log: collectLogs() },
      ),
    ).rejects.toBeInstanceOf(MediaOffloadError);

    // Input-validation path: invalid base64 must NOT be wrapped as
    // MediaOffloadError.
    const inputErr = parseMessageWithAttachments(
      "x",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "bad.png",
          content: "%not-base64%",
        },
      ],
      { log: collectLogs() },
    );
    await expect(inputErr).rejects.toThrow(/base64/i);
    await expect(inputErr).rejects.not.toBeInstanceOf(MediaOffloadError);
  });

  it("never injects the raw absolute saveMediaBuffer path into the returned message", async () => {
    const bigJpg = await largeJpegBase64();
    const savedPath = "/home/attacker/../../etc/passwd-shaped/photo---xyz.jpg";
    saveMediaBufferMock.mockResolvedValueOnce({ id: "photo---xyz.jpg", path: savedPath });

    const parsed = await parseMessageWithAttachments(
      "greetings",
      [{ type: "image", mimeType: "image/jpeg", fileName: "photo.jpg", content: bigJpg }],
      { log: collectLogs() },
    );

    expect(parsed.message).toContain("media://inbound/photo---xyz.jpg");
    expect(parsed.message).not.toContain(savedPath);
    expect(parsed.message).not.toMatch(/\/home\/attacker/);
    expect(parsed.offloadedRefs[0]?.path).toBe(savedPath);
  });
});
