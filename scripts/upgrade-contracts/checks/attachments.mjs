// Attachment checks.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
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
  name: "Large attachment parsing is bounded and returns structured offloadedRefs",
  groups: ["attachments"],
  matrixIds: ["UM-22a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging gateway session.",
      "Sample PDF, DOCX, JSONL, unknown-binary, and >10 MB image files staged locally.",
    ],
    steps: [
      "Upload each file type via both WebSocket and HTTP transports.",
      "Inspect the returned message payload for offloadedRefs entries with path, mime, label, size.",
      "Have the agent invoke a read tool against the offloaded path; verify content accessibility.",
    ],
    expected:
      "Every non-image accepted file produces a structured OffloadedRef; agent can read via the returned path.",
    evidence: ["offloadedRefs JSON for each upload.", "Read-tool response for each file."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["one offloaded file per upload"],
      cleanupRollback: ["delete uploaded files after verification"],
      evidenceCapture: ["offloadedRefs", "read responses"],
    },
  },
});

defineCheck({
  id: "attachments.hostile-labels-manual",
  name: "Hostile labels/limits are refused with a bounded error; order preserved",
  groups: ["attachments"],
  matrixIds: ["UM-22b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Staging gateway with sample malformed uploads."],
    steps: [
      "Upload files with path-traversal labels, oversized labels, and null-byte labels.",
      "Verify each is refused with a documented error, not a crash.",
      "Verify order of operations places validation before persistence.",
    ],
    expected:
      "Malicious inputs are refused with bounded errors; no persistence side-effects on refuse.",
    evidence: ["Error responses; server log excerpt showing validation order."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["error responses", "log excerpt"],
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
