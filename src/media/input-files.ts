import { fetchWithSsrFGuard } from "../infra/net/fetch-guard.js";
import type { SsrFPolicy } from "../infra/net/ssrf.js";
import { logWarn } from "../logger.js";
import { canonicalizeBase64, estimateBase64DecodedBytes } from "./base64.js";
import { convertHeicToJpeg } from "./image-ops.js";
import { detectMime } from "./mime.js";
import { extractPdfContent, type PdfExtractedImage } from "./pdf-extract.js";
import { readResponseWithLimit } from "./read-response-with-limit.js";

export type InputImageContent = PdfExtractedImage;

export type InputFileExtractResult = {
  filename: string;
  text?: string;
  images?: InputImageContent[];
};

export type InputPdfLimits = {
  maxPages: number;
  maxPixels: number;
  minTextChars: number;
};

export type InputFileLimits = {
  allowUrl: boolean;
  urlAllowlist?: string[];
  allowedMimes: Set<string>;
  /**
   * Set when the configured allowlist contains a wildcard ("*" or "*\/*").
   * The MIME allowlist is then skipped entirely and unknown types are handed to
   * the model instead of failing the request. Size limits still apply.
   */
  allowAllMimes: boolean;
  maxBytes: number;
  maxChars: number;
  maxRedirects: number;
  timeoutMs: number;
  pdf: InputPdfLimits;
};

export type InputFileLimitsConfig = {
  allowUrl?: boolean;
  allowedMimes?: string[];
  maxBytes?: number;
  maxChars?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  pdf?: {
    maxPages?: number;
    maxPixels?: number;
    minTextChars?: number;
  };
};

export type InputImageLimits = {
  allowUrl: boolean;
  urlAllowlist?: string[];
  allowedMimes: Set<string>;
  /** See InputFileLimits.allowAllMimes. Absent means "enforce the allowlist". */
  allowAllMimes?: boolean;
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
};

export type InputImageSource =
  | {
      type: "base64";
      data: string;
      mediaType?: string;
    }
  | {
      type: "url";
      url: string;
      mediaType?: string;
    };

export type InputFileSource =
  | {
      type: "base64";
      data: string;
      mediaType?: string;
      filename?: string;
    }
  | {
      type: "url";
      url: string;
      mediaType?: string;
      filename?: string;
    };

export type InputFetchResult = {
  buffer: Buffer;
  mimeType: string;
  contentType?: string;
};

export const DEFAULT_INPUT_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
];
export const DEFAULT_INPUT_FILE_MIMES = [
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
  "text/calendar",
  "application/json",
  "application/jsonl",
  "application/x-ndjson",
  "application/x-jsonlines",
  "application/pdf",
];
export const DEFAULT_INPUT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_INPUT_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_INPUT_FILE_MAX_CHARS = 200_000;
export const DEFAULT_INPUT_MAX_REDIRECTS = 3;
export const DEFAULT_INPUT_TIMEOUT_MS = 10_000;
export const DEFAULT_INPUT_PDF_MAX_PAGES = 4;
export const DEFAULT_INPUT_PDF_MAX_PIXELS = 4_000_000;
export const DEFAULT_INPUT_PDF_MIN_TEXT_CHARS = 200;
const NORMALIZED_INPUT_IMAGE_MIME = "image/jpeg";
const HEIC_INPUT_IMAGE_MIMES = new Set(["image/heic", "image/heif"]);

function rejectOversizedBase64Payload(params: {
  data: string;
  maxBytes: number;
  label: "Image" | "File";
}): void {
  const estimated = estimateBase64DecodedBytes(params.data);
  if (estimated > params.maxBytes) {
    throw new Error(
      `${params.label} too large: ${estimated} bytes (limit: ${params.maxBytes} bytes)`,
    );
  }
}

export function normalizeMimeType(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const [raw] = value.split(";");
  const normalized = raw?.trim().toLowerCase();
  return normalized || undefined;
}

export function parseContentType(value: string | undefined): {
  mimeType?: string;
  charset?: string;
} {
  if (!value) {
    return {};
  }
  const parts = value.split(";").map((part) => part.trim());
  const mimeType = normalizeMimeType(parts[0]);
  const charset = parts
    .map((part) => part.match(/^charset=(.+)$/i)?.[1]?.trim())
    .find((part) => part && part.length > 0);
  return { mimeType, charset };
}

export function normalizeMimeList(values: string[] | undefined, fallback: string[]): Set<string> {
  const input = values && values.length > 0 ? values : fallback;
  return new Set(input.map((value) => normalizeMimeType(value)).filter(Boolean) as string[]);
}

const MIME_WILDCARDS = new Set(["*", "*/*"]);

/**
 * True when an operator has opted out of MIME policing by putting a wildcard in
 * the allowlist. Deliberately only honors an *explicit* wildcard: an empty or
 * absent list still means "use the defaults", so this cannot be triggered by
 * accident. Only consults the configured list, never the fallback, so the
 * built-in defaults can never turn themselves into allow-all.
 */
export function mimeListAllowsAll(values: string[] | undefined): boolean {
  if (!values || values.length === 0) {
    return false;
  }
  return values.some((value) => {
    const normalized = normalizeMimeType(value);
    return normalized ? MIME_WILDCARDS.has(normalized) : false;
  });
}

export function resolveInputFileLimits(config?: InputFileLimitsConfig): InputFileLimits {
  return {
    allowUrl: config?.allowUrl ?? true,
    allowedMimes: normalizeMimeList(config?.allowedMimes, DEFAULT_INPUT_FILE_MIMES),
    allowAllMimes: mimeListAllowsAll(config?.allowedMimes),
    maxBytes: config?.maxBytes ?? DEFAULT_INPUT_FILE_MAX_BYTES,
    maxChars: config?.maxChars ?? DEFAULT_INPUT_FILE_MAX_CHARS,
    maxRedirects: config?.maxRedirects ?? DEFAULT_INPUT_MAX_REDIRECTS,
    timeoutMs: config?.timeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS,
    pdf: {
      maxPages: config?.pdf?.maxPages ?? DEFAULT_INPUT_PDF_MAX_PAGES,
      maxPixels: config?.pdf?.maxPixels ?? DEFAULT_INPUT_PDF_MAX_PIXELS,
      minTextChars: config?.pdf?.minTextChars ?? DEFAULT_INPUT_PDF_MIN_TEXT_CHARS,
    },
  };
}

export async function fetchWithGuard(params: {
  url: string;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  policy?: SsrFPolicy;
  auditContext?: string;
}): Promise<InputFetchResult> {
  const { response, release } = await fetchWithSsrFGuard({
    url: params.url,
    maxRedirects: params.maxRedirects,
    timeoutMs: params.timeoutMs,
    policy: params.policy,
    auditContext: params.auditContext,
    init: { headers: { "User-Agent": "OpenClaw-Gateway/1.0" } },
  });

  try {
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const size = Number(contentLength);
      if (Number.isFinite(size) && size > params.maxBytes) {
        throw new Error(`Content too large: ${size} bytes (limit: ${params.maxBytes} bytes)`);
      }
    }

    const buffer = await readResponseWithLimit(response, params.maxBytes);

    const contentType = response.headers.get("content-type") || undefined;
    const parsed = parseContentType(contentType);
    const mimeType = parsed.mimeType ?? "application/octet-stream";
    return { buffer, mimeType, contentType };
  } finally {
    await release();
  }
}

function decodeTextContent(buffer: Buffer, charset: string | undefined): string {
  const encoding = charset?.trim().toLowerCase() || "utf-8";
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

const BINARY_SNIFF_LENGTH = 8192;
const BINARY_REPLACEMENT_RATIO = 0.3;
/**
 * Below this many decoded characters the replacement ratio is noise, not
 * signal: a 9-byte cp1252 string with one smart quote is 11% replacements but
 * is obviously text. Short inputs fall back to the NUL check alone.
 */
const BINARY_RATIO_MIN_SAMPLE = 64;

/**
 * Heuristic "is this actually text?" check, run *after* decoding rather than by
 * sniffing magic bytes: the goal is not to identify the format, only to avoid
 * pushing a wall of U+FFFD at the model once the MIME allowlist is disabled.
 *
 * A NUL byte in the head is decisive for single-byte encodings, but is normal
 * in UTF-16, so that check is skipped when the charset says UTF-16. Otherwise
 * we fall back to how many replacement characters the decoder had to emit.
 */
function looksLikeBinaryContent(
  buffer: Buffer,
  decoded: string,
  charset: string | undefined,
): boolean {
  const encoding = charset?.trim().toLowerCase() ?? "";
  const isUtf16 = encoding.startsWith("utf-16") || encoding.startsWith("utf16");
  if (!isUtf16 && buffer.subarray(0, BINARY_SNIFF_LENGTH).includes(0)) {
    return true;
  }
  if (decoded.length < BINARY_RATIO_MIN_SAMPLE) {
    return false;
  }
  const sampled = Math.min(decoded.length, BINARY_SNIFF_LENGTH);
  let replacements = 0;
  for (let index = 0; index < sampled; index++) {
    if (decoded.charCodeAt(index) === 0xfffd) {
      replacements++;
    }
  }
  return replacements / sampled > BINARY_REPLACEMENT_RATIO;
}

function renderBinaryPlaceholder(mimeType: string, byteLength: number): string {
  return `[binary file: ${mimeType}, ${byteLength} bytes, no text extracted]`;
}

async function normalizeInputImage(params: {
  buffer: Buffer;
  mimeType?: string;
  limits: InputImageLimits;
}): Promise<InputImageContent> {
  const declaredMime = normalizeMimeType(params.mimeType) ?? "application/octet-stream";
  const detectedMime = normalizeMimeType(
    await detectMime({ buffer: params.buffer, headerMime: params.mimeType }),
  );
  if (declaredMime.startsWith("image/") && detectedMime && !detectedMime.startsWith("image/")) {
    throw new Error(`Unsupported image MIME type: ${detectedMime}`);
  }
  const sourceMime =
    (detectedMime && HEIC_INPUT_IMAGE_MIMES.has(detectedMime)) ||
    (HEIC_INPUT_IMAGE_MIMES.has(declaredMime) && !detectedMime)
      ? (detectedMime ?? declaredMime)
      : declaredMime;
  if (!params.limits.allowAllMimes && !params.limits.allowedMimes.has(sourceMime)) {
    throw new Error(`Unsupported image MIME type: ${sourceMime}`);
  }

  if (!HEIC_INPUT_IMAGE_MIMES.has(sourceMime)) {
    return {
      type: "image",
      data: params.buffer.toString("base64"),
      mimeType: sourceMime,
    };
  }

  const normalizedBuffer = await convertHeicToJpeg(params.buffer);
  if (normalizedBuffer.byteLength > params.limits.maxBytes) {
    throw new Error(
      `Image too large after HEIC conversion: ${normalizedBuffer.byteLength} bytes (limit: ${params.limits.maxBytes} bytes)`,
    );
  }
  return {
    type: "image",
    data: normalizedBuffer.toString("base64"),
    mimeType: NORMALIZED_INPUT_IMAGE_MIME,
  };
}

export async function extractImageContentFromSource(
  source: InputImageSource,
  limits: InputImageLimits,
): Promise<InputImageContent> {
  if (source.type === "base64") {
    rejectOversizedBase64Payload({ data: source.data, maxBytes: limits.maxBytes, label: "Image" });
    const canonicalData = canonicalizeBase64(source.data);
    if (!canonicalData) {
      throw new Error("input_image base64 source has invalid 'data' field");
    }
    const buffer = Buffer.from(canonicalData, "base64");
    if (buffer.byteLength > limits.maxBytes) {
      throw new Error(
        `Image too large: ${buffer.byteLength} bytes (limit: ${limits.maxBytes} bytes)`,
      );
    }
    return await normalizeInputImage({
      buffer,
      mimeType: normalizeMimeType(source.mediaType) ?? "image/png",
      limits,
    });
  }

  if (source.type === "url") {
    if (!limits.allowUrl) {
      throw new Error("input_image URL sources are disabled by config");
    }
    const result = await fetchWithGuard({
      url: source.url,
      maxBytes: limits.maxBytes,
      timeoutMs: limits.timeoutMs,
      maxRedirects: limits.maxRedirects,
      policy: {
        allowPrivateNetwork: false,
        hostnameAllowlist: limits.urlAllowlist,
      },
      auditContext: "openresponses.input_image",
    });
    return await normalizeInputImage({
      buffer: result.buffer,
      mimeType: result.mimeType,
      limits,
    });
  }

  throw new Error(`Unsupported input_image source type: ${(source as { type: string }).type}`);
}

export async function extractFileContentFromSource(params: {
  source: InputFileSource;
  limits: InputFileLimits;
}): Promise<InputFileExtractResult> {
  const { source, limits } = params;
  const filename = source.filename || "file";

  let buffer: Buffer;
  let mimeType: string | undefined;
  let charset: string | undefined;

  if (source.type === "base64") {
    rejectOversizedBase64Payload({ data: source.data, maxBytes: limits.maxBytes, label: "File" });
    const canonicalData = canonicalizeBase64(source.data);
    if (!canonicalData) {
      throw new Error("input_file base64 source has invalid 'data' field");
    }
    const parsed = parseContentType(source.mediaType);
    mimeType = parsed.mimeType;
    charset = parsed.charset;
    buffer = Buffer.from(canonicalData, "base64");
  } else {
    if (!limits.allowUrl) {
      throw new Error("input_file URL sources are disabled by config");
    }
    const result = await fetchWithGuard({
      url: source.url,
      maxBytes: limits.maxBytes,
      timeoutMs: limits.timeoutMs,
      maxRedirects: limits.maxRedirects,
      policy: {
        allowPrivateNetwork: false,
        hostnameAllowlist: limits.urlAllowlist,
      },
      auditContext: "openresponses.input_file",
    });
    const parsed = parseContentType(result.contentType);
    mimeType = parsed.mimeType ?? normalizeMimeType(result.mimeType);
    charset = parsed.charset;
    buffer = result.buffer;
  }

  if (buffer.byteLength > limits.maxBytes) {
    throw new Error(`File too large: ${buffer.byteLength} bytes (limit: ${limits.maxBytes} bytes)`);
  }

  // With allowAllMimes the harness deliberately stops policing formats: an
  // unknown or undeclared type is handed to the model (as text when it decodes
  // cleanly, as a placeholder when it does not) instead of failing the request.
  // maxBytes above is still enforced, so "allow all" is not "allow unbounded".
  const resolvedMime = mimeType ?? (limits.allowAllMimes ? "application/octet-stream" : undefined);
  if (!resolvedMime) {
    throw new Error("input_file missing media type");
  }
  if (!limits.allowAllMimes && !limits.allowedMimes.has(resolvedMime)) {
    throw new Error(`Unsupported file MIME type: ${resolvedMime}`);
  }

  if (resolvedMime === "application/pdf") {
    const extracted = await extractPdfContent({
      buffer,
      maxPages: limits.pdf.maxPages,
      maxPixels: limits.pdf.maxPixels,
      minTextChars: limits.pdf.minTextChars,
      onImageExtractionError: (err) => {
        logWarn(`media: PDF image extraction skipped, ${String(err)}`);
      },
    });
    const text = extracted.text ? clampText(extracted.text, limits.maxChars) : "";
    return {
      filename,
      text,
      images: extracted.images.length > 0 ? extracted.images : undefined,
    };
  }

  const decoded = decodeTextContent(buffer, charset);
  if (looksLikeBinaryContent(buffer, decoded, charset)) {
    return { filename, text: renderBinaryPlaceholder(resolvedMime, buffer.byteLength) };
  }
  return { filename, text: clampText(decoded, limits.maxChars) };
}
