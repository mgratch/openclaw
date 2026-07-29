// Attachment checks.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import {
  FOCUSED_ATTACHMENTS_TEST_FILES,
  MIN_FOCUSED_ATTACHMENTS_TESTS,
  runFocusedAttachmentsSuite,
} from "../lib/attachments-suite.mjs";
import { REPO_ROOT } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "attachments.mime-allowlist-inventory",
  name: "input-files MIME allowlist includes text/calendar and JSONL variants; no blanket text/* bypass",
  groups: ["attachments"],
  matrixIds: ["UM-12", "CP-03"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const p = path.join(REPO_ROOT, "src", "media", "input-files.ts");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    const src = await fs.readFile(p, "utf8");
    const evidence = [
      { label: "text/calendar", value: /text\/calendar/i.test(src) },
      { label: "application/jsonl", value: /application\/jsonl/i.test(src) },
      { label: "application/x-ndjson", value: /application\/x-ndjson/i.test(src) },
    ];
    const missing = evidence.filter((e) => !e.value).map((e) => e.label);
    if (missing.length > 0) {
      return { status: "fail", evidence, notes: `Missing MIME entries: ${missing.join(", ")}` };
    }
    const bypass = /allowedMimes[^]*text\//.test(src) && /text\/\*/.test(src);
    if (bypass) {
      return { status: "fail", evidence, notes: "Blanket text/* bypass detected in the allowlist" };
    }
    return { status: "pass", evidence };
  },
});

defineCheck({
  id: "attachments.large-parsing-manual",
  name: "Large supported-image attachments are offloaded to structured offloadedRefs; non-image chat attachments are dropped",
  groups: ["attachments"],
  matrixIds: ["UM-22a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging gateway session.",
      "Sample >2 MB images in each supported offload format (JPEG, PNG, WebP, GIF, HEIC, HEIF) staged locally.",
      "One small image (<2 MB) staged so a mixed inline+offloaded batch can be exercised.",
      "The ability to induce a storage failure for one attachment (for example a temporarily read-only media dir).",
    ],
    steps: [
      "Upload each supported large image via both WebSocket and HTTP transports.",
      "Upload a mixed batch containing one small image and one supported large image in the same request; confirm imageOrder preserves the original attachment order (inline first, offloaded second when that is the input order).",
      "Confirm the returned message contains a `[media attached: media://inbound/<id>]` marker for each offloaded image and that the absolute filesystem path from saveMediaBuffer never appears in the message body.",
      "Inspect the returned payload for offloadedRefs entries with mediaRef, id, path, mimeType, label.",
      "Trigger a storage failure on the second attachment of a two-attachment request and verify the first offload is cleaned up (deleteMediaBuffer invoked) and that the caller receives a MediaOffloadError.",
      "Persist a transcript for a successful offloaded upload and confirm the transcript metadata carries the offloadedRefs (MediaPath/MediaPaths) rather than dropping the large image.",
    ],
    expected:
      "Every supported large image produces a structured OffloadedRef and a media:// marker; mixed batches preserve imageOrder; storage failure yields MediaOffloadError with cleanup of any earlier offload; transcript metadata retains the offloaded refs. Non-image chat attachments (PDF/DOCX/JSONL/unknown-binary) are silently dropped by this parser — they are NOT offloaded and NOT preserved via chat.send in this baseline.",
    evidence: [
      "offloadedRefs JSON for each supported-format upload.",
      "Mixed-batch parse result showing imageOrder.",
      "MediaOffloadError response with cleanup log line for the storage-failure case.",
      "Transcript metadata excerpt showing MediaPath entries from offloadedRefs.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one offloaded file per supported-format upload"],
      cleanupRollback: ["delete offloaded files after verification"],
      evidenceCapture: ["offloadedRefs", "MediaOffloadError response", "transcript metadata"],
    },
  },
});

defineCheck({
  id: "attachments.hostile-labels-manual",
  name: "Hostile labels are safely refused OR persisted with a sanitized, contained media id — never as a raw unsafe path",
  groups: ["attachments"],
  matrixIds: ["UM-22b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Staging gateway with sample uploads carrying hostile labels."],
    steps: [
      "Upload attachments carrying path-traversal-shaped labels (for example `../../etc/passwd.txt`, `..\\..\\evil.exe`), null-byte labels, oversized labels, and labels made entirely of special characters.",
      "For each hostile label, confirm the outcome is one of the two acceptable dispositions and never a third: (a) the request is refused with a bounded documented error and no persistence side-effect, OR (b) the saveMediaBuffer path sanitizes the label and stores the file under `~/.openclaw/media/inbound/` with an id that contains no path separators, no null bytes, and does not resolve outside the inbound directory.",
      "Confirm the returned media id / media:// marker never contains a raw traversal segment, absolute host path, or null byte — even when the label sanitizes down to the empty string (in which case the id must fall back to `<uuid>.<ext>`).",
      "Verify order of operations places input validation and buffer decode BEFORE any media-store write, so an input-validation failure never leaves a partial file on disk.",
    ],
    expected:
      "Hostile-labeled uploads either yield a bounded refusal with no filesystem side-effects, or they persist to a sanitized, contained media id whose path stays under the inbound directory. There is no third outcome: a raw traversal segment, absolute host path, or unsafe id must never appear in the persisted id, the media:// marker, or the returned message body.",
    evidence: [
      "For each hostile label: either the refusal error response, or the saved id + resolved absolute path proving containment.",
      "Log excerpt showing input validation runs before media-store writes.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: false,
      writesWorkspaceFiles: true,
      expectedMutations: ["at most one sanitized-id file per persisted hostile upload"],
      cleanupRollback: ["delete any persisted sanitized-id files after verification"],
      evidenceCapture: ["refusal errors", "saved ids and paths", "log excerpt"],
    },
  },
});

defineCheck({
  id: "attachments.jsonl-mime-manual",
  name: "JSONL upload is accepted end-to-end",
  groups: ["attachments"],
  matrixIds: ["UM-12", "CP-03"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["A staging gateway session and a small JSONL sample file."],
    steps: [
      "Upload the JSONL via HTTP.",
      "Have the agent invoke a read tool on the offloaded path.",
    ],
    expected:
      "The upload is accepted, the offloadedRef is present, and the agent can read line by line.",
    evidence: ["Full upload response and read-tool output."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one uploaded JSONL"],
      cleanupRollback: ["delete uploaded file after verification"],
      evidenceCapture: ["response", "read output"],
    },
  },
});

// -- Behavior: automated attachments focused-Vitest suite ---------------------

const ATTACHMENTS_VITEST_ENTRY = path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");

const ATTACHMENTS_PROVEN_NOTE =
  "Proves unit/integration behavior only, not real WebSocket/HTTP upload transport, live gateway persistence, or agent read-tool continuity. " +
  "Covers: supported large image offload to structured refs + media:// markers with imageOrder preserved and no absolute path leakage; " +
  "unsupported oversized image formats refused before the media store is touched; " +
  "unsafe/empty saved media IDs and storage failures classified as MediaOffloadError; " +
  "later-attachment failure cleans up earlier saved IDs; input-validation errors stay ordinary Error; " +
  "media store containment for traversal-shaped, null-byte, oversized, and special-character labels; " +
  "default input-file MIME allowlist includes text/calendar, application/jsonl, application/x-ndjson with no blanket text/* bypass.";

defineCheck({
  id: "attachments.focused-behavior",
  name: `Focused attachments Vitest suite proves offload behavior, saved-id containment, and MIME allowlist (${FOCUSED_ATTACHMENTS_TEST_FILES.length} files, >=${MIN_FOCUSED_ATTACHMENTS_TESTS} tests)`,
  groups: ["attachments"],
  matrixIds: ["UM-22a", "UM-22b", "UM-12", "CP-03"],
  kind: "behavior",
  automated: "auto",
  async run() {
    if (!existsSync(ATTACHMENTS_VITEST_ENTRY)) {
      return {
        status: "fail",
        evidence: [{ label: "local vitest entry exists", value: false }],
        notes: "Local Vitest entry is missing; refusing to fall back to pnpm/Corepack.",
      };
    }
    const result = await runFocusedAttachmentsSuite();
    const suiteNotes = typeof result.notes === "string" ? result.notes : "";
    const combined = suiteNotes
      ? `${suiteNotes} ${ATTACHMENTS_PROVEN_NOTE}`
      : ATTACHMENTS_PROVEN_NOTE;
    return { ...result, notes: combined };
  },
});
