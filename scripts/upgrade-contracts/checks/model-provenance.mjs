// Model override and response provenance checks.
//
// Automated portion asserts source-level inventory. The Opus 4.8 target and
// the UI presets are inspected — the previous check asserted only the core
// preset file, which the audits flagged as inadequate. When the UI target
// file is missing, the inventory check must FAIL, not silently PASS.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, UI_ROOT } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "model-provenance.opus-5-canonical-inventory",
  name: "No source file exposes claude-opus-5-0 as a selectable option",
  groups: ["model-provenance"],
  matrixIds: ["MODEL-03"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const targets = [
      path.join(REPO_ROOT, "src", "acp", "presets.ts"),
      path.join(UI_ROOT, "src", "constants", "acpPresets.ts"),
    ];
    const findings = [];
    for (const p of targets) {
      if (!existsSync(p)) {
        findings.push({ path: p, present: null, error: "missing" });
        continue;
      }
      const src = await fs.readFile(p, "utf8");
      findings.push({ path: p, present: /claude-opus-5-0\b/.test(src) });
    }
    const missingFiles = findings.filter((f) => f.error === "missing");
    if (missingFiles.length > 0) {
      return {
        status: "fail",
        evidence: findings.map((f) => ({
          label: f.path,
          value: f.error ?? (f.present ? "present" : "absent"),
        })),
        notes: `Target inventory files missing: ${missingFiles.map((f) => f.path).join(", ")}`,
      };
    }
    const offenders = findings.filter((f) => f.present);
    if (offenders.length > 0) {
      return {
        status: "fail",
        evidence: findings.map((f) => ({ label: f.path, value: f.present ? "present" : "absent" })),
        notes: `Invalid claude-opus-5-0 still present in: ${offenders.map((o) => o.path).join(", ")}`,
      };
    }
    return { status: "pass", evidence: findings.map((f) => ({ label: f.path, value: "absent" })) };
  },
});

defineCheck({
  id: "model-provenance.opus-4-8-inventory",
  name: "Direct Opus 4.8 model is allowed and declared by the effective gateway catalog",
  groups: ["model-provenance"],
  matrixIds: ["MODEL-02"],
  kind: "inventory",
  requires: ["openclaw.json"],
  automated: "auto",
  async run(ctx) {
    const entry = ctx?.env?.openClawJson?.requiredModels?.find(
      (model) => model.id === "anthropic/claude-opus-4-8",
    );
    if (!entry) {
      return {
        status: "fail",
        notes: "Effective config probe did not return the Opus 4.8 catalog entry",
      };
    }
    const evidence = [
      { label: "anthropic/claude-opus-4-8 allowed", value: entry.allowed === true },
      { label: "claude-opus-4-8 provider model declared", value: entry.providerDeclared === true },
    ];
    const missing = evidence.filter((item) => !item.value).map((item) => item.label);
    if (missing.length > 0) {
      return {
        status: "fail",
        evidence,
        notes: `Opus 4.8 direct-model inventory incomplete: ${missing.join("; ")}`,
      };
    }
    return {
      status: "pass",
      evidence,
      notes:
        "This validates the direct Anthropic model used by shared gateway-catalog selectors. Claude Code ACP presets remain separate and must not advertise unsupported model IDs.",
    };
  },
});

defineCheck({
  id: "model-provenance.opus-4-8-manual",
  name: "Opus 4.8 dispatch echoes the real active model",
  groups: ["model-provenance"],
  matrixIds: ["MODEL-02"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Staging Anthropic account balance for the current window.",
      "The Opus 4.8 selector visible in the UI.",
    ],
    steps: [
      "Select Opus 4.8 in the UI.",
      "Send a short prompt asking the model to echo its model id.",
      "Inspect the response metadata and the API log for the returned model id.",
    ],
    expected: "Response metadata identifies claude-opus-4-8; no silent fallback.",
    evidence: ["Truncated response metadata.", "API log line with the response model id."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging balance only"],
      evidenceCapture: ["metadata", "API log"],
    },
  },
});

defineCheck({
  id: "model-provenance.opus-5-live-manual",
  name: "Opus 5 dispatch is either supported or fails visibly",
  groups: ["model-provenance"],
  matrixIds: ["MODEL-03"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Staging Anthropic account balance and Opus 5 access."],
    steps: [
      "Select a preset that references claude-opus-5 (canonical form only).",
      "Send a short prompt.",
      "Confirm the response identifies claude-opus-5 or the request fails with a visible error.",
    ],
    expected: "Silent fallback is impossible.",
    evidence: ["Response metadata and error banner (if any)."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging balance only"],
      evidenceCapture: ["metadata", "banner"],
    },
  },
});

defineCheck({
  id: "model-provenance.sol-provider-path-manual",
  name: "SOL 5.6 dispatch resolves to the correct provider path",
  groups: ["model-provenance"],
  matrixIds: ["MODEL-01"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Both openai-codex/gpt-5.6-sol and openai/gpt-5.6-sol paths configured in staging openclaw.json.",
    ],
    steps: [
      "Select SOL 5.6 High in the UI.",
      "Send a prompt.",
      "Inspect the response metadata for the actual provider id used.",
    ],
    expected:
      "Response metadata identifies the intended SOL provider path; no silent GPT-5.5 fallback.",
    evidence: ["Truncated response metadata."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging balance only"],
      evidenceCapture: ["metadata"],
    },
  },
});

defineCheck({
  id: "model-provenance.sol-atomic-send-manual",
  name: "SOL 5.6 model + thinking effort atomic across WS/HTTP/edit/retry",
  groups: ["model-provenance"],
  matrixIds: ["UI-02a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Staging UI checkpoint build with SOL presets enabled."],
    steps: [
      "Send a WS message with SOL High selected; verify payload includes both model and thinking.",
      "Repeat via HTTP file upload.",
      "Edit and resend the message.",
      "Retry from the error state.",
    ],
    expected:
      "In every path the resolved model id AND thinking effort are carried together; moving to Base clears prior effort.",
    evidence: ["WebSocket / HTTP request captures for each path."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging balance only"],
      evidenceCapture: ["request captures"],
    },
  },
});

defineCheck({
  id: "model-provenance.sol-thinking-reset-manual",
  name: "SOL Base resets prior thinking; fallback exclusion for Off; ExtraHigh-Pro roundtrip; config rollback",
  groups: ["model-provenance"],
  matrixIds: ["UI-02b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Staging UI with SOL presets; ability to inspect params.thinking per send."],
    steps: [
      "Select SOL High; send a turn (thinking=high).",
      "Switch to SOL Base; send another turn.",
      "Verify the new turn's params.thinking is a documented reset value (not stale high).",
      "Switch to SOL Off; verify Off is excluded from fallback chain.",
      "Roundtrip SOL ExtraHigh -> Pro -> ExtraHigh; verify each dispatch carries the correct pair.",
      "Roll back to the prior config; verify the send behavior returns to baseline.",
    ],
    expected:
      "Base clears the prior effort; Off is not selected as a fallback; ExtraHigh-Pro roundtrip preserves identity; rollback returns to baseline.",
    evidence: ["Request payloads and session config snapshots for each step."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["staging session config toggles"],
      cleanupRollback: ["restore original session config after test"],
      evidenceCapture: ["payloads", "config snapshots"],
    },
  },
});

defineCheck({
  id: "model-provenance.acp-preset-manual",
  name: "ACP preset routing echoes the resolved model on every path",
  groups: ["model-provenance"],
  matrixIds: ["UM-02", "UM-21"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Live staging ACP session with a valid preset selected."],
    steps: [
      "Send a prompt via the UI.",
      "Send a prompt via HTTP.",
      "Send an edit/resend and a retry.",
    ],
    expected:
      "Every route reports the same resolved model in response metadata; no SDK-default fallback.",
    evidence: ["Response metadata for each path."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging balance only"],
      evidenceCapture: ["metadata"],
    },
  },
});

defineCheck({
  id: "model-provenance.per-turn-model-manual",
  name: "Per-turn model selection is honored end-to-end and reported in response metadata",
  groups: ["model-provenance"],
  matrixIds: ["UM-08c"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Staging session with distinct model per turn."],
    steps: [
      "Send turn 1 with model A; verify metadata identifies A.",
      "Send turn 2 with model B in the same session; verify metadata identifies B.",
      "Retry turn 1 while turn 2 was already sent; verify model A on the retry.",
    ],
    expected:
      "Each turn's response metadata reports the requested model; per-turn choice is stable.",
    evidence: ["Response metadata for all three turns."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging balance only"],
      evidenceCapture: ["metadata"],
    },
  },
});
