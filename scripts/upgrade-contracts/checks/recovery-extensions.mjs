// Fail-closed automatic behavior contract for the two deployed out-of-tree
// recovery extensions (session-context-recovery and transcript-archive).
//
// This check spawns a child Node 24 process (via --experimental-strip-types)
// against a freshly-created disposable HOME, imports the real deployed
// extension TypeScript entrypoints from ~/.openclaw/extensions/, and asserts
// their observable behavior against fixtures rooted entirely inside the
// disposable HOME.
//
// It NEVER touches production ~/.openclaw workspace, archives, UI
// transcripts, config, gateway, databases, network, or any package installer.
// Evidence carries only assertion counts, booleans, and durations.
//
// This proves deployed extension behavior on disposable fixtures, not real
// compaction / runtime-flip continuity (which UM-05b post-compaction and
// UM-08d transcript-inject manual contracts continue to cover).

import { runRecoveryExtensionsProbe } from "../lib/recovery-extensions-suite.mjs";
import { defineCheck } from "../lib/runner.mjs";

const PROVEN_NOTE =
  "Proves deployed extension behavior on disposable fixtures, not real " +
  "compaction/runtime-flip continuity. session-context-recovery: sync " +
  "before_prompt_build registration at priority 10; UI transcript preferred " +
  "over archive with role ordering preserved; malformed JSONL ignored; " +
  "archive-only sentinel absent when UI is available; >2-message contexts " +
  "return no prependContext; subagent/run session keys skipped; missing " +
  "transcript returns no prependContext; archive fallback works; per-message " +
  "and total recovery bounds are enforced. transcript-archive: synchronous " +
  "registration installing all expected lifecycle/message/tool/compaction " +
  "hooks plus CLI/service; session_start + sparse hooks route through the " +
  "session tracker to the same sanitized in-root archive directory; a " +
  "traversal-shaped session key stays inside the disposable archive root; " +
  "hook order is preserved in the transcript JSONL; a tiny " +
  "toolResultSplitThreshold splits a large tool result to a file under the " +
  "same in-root session directory with the transcript entry recording only " +
  "reference metadata; before_compaction snapshot copy completes inside the " +
  "disposable session archive and the source fixture is unchanged.";

defineCheck({
  id: "recovery-extensions.disposable-behavior",
  name:
    "Deployed session-context-recovery and transcript-archive extensions " +
    "behave as expected against disposable fixtures in an isolated child Node 24 " +
    "process (--experimental-strip-types)",
  groups: ["history-recovery", "transcript-archive"],
  matrixIds: ["RT-02", "RT-03"],
  kind: "behavior",
  requires: ["extension.session-context-recovery", "extension.transcript-archive"],
  automated: "auto",
  async run() {
    const result = await runRecoveryExtensionsProbe();
    const suiteNotes = typeof result.notes === "string" ? result.notes : "";
    const combined = suiteNotes ? `${suiteNotes} ${PROVEN_NOTE}` : PROVEN_NOTE;
    return { ...result, notes: combined };
  },
});
