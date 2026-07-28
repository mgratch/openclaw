# OpenClaw upgrade-contracts baseline report

_Schema:_ `openclaw-upgrade-contracts/v2` · _Run:_ `2026-07-28T02-46-36-821Z-2af026b6` · _Mode:_ `report-only` · _Filtered:_ `no`
_Started:_ 2026-07-28T02:46:36.822Z · _Finished:_ 2026-07-28T02:47:33.960Z
_Git HEAD:_ `a0cfa5090b00f1deeec9aef21f9a3a8e537d0d00`
_Runtime version:_ `2026.4.2`

## Gate decision

- Result: **FAIL**
- Blockers: **54**
  - `check-manual` — memory-firewall.subagent-idempotency-manual pending manual attestation
  - `check-manual` — memory-firewall.target-runtime-manual pending manual attestation
  - `check-manual` — mounts-permissions.host-mount-access-manual pending manual attestation
  - `check-manual` — mounts-permissions.container-setup-manual pending manual attestation
  - `check-manual` — history-recovery.large-history-manual pending manual attestation
  - `check-manual` — history-recovery.post-compaction-manual pending manual attestation
  - `check-manual` — history-recovery.compaction-quality-manual pending manual attestation
  - `check-manual` — history-recovery.workspace-limits-manual pending manual attestation
  - `check-manual` — history-recovery.codex-overflow-manual pending manual attestation
  - `check-manual` — transcript-archive.injection-manual pending manual attestation
  - `check-manual` — streaming-cleanup.terminal-cleanup-manual pending manual attestation
  - `check-manual` — streaming-cleanup.empty-final-manual pending manual attestation
  - `check-manual` — streaming-cleanup.wrap-up-idempotent-manual pending manual attestation
  - `check-manual` — streaming-cleanup.ghost-stream-manual pending manual attestation
  - `check-manual` — two-tab-scoping.session-scoping-manual pending manual attestation
  - `check-manual` — steering.mid-run-manual pending manual attestation
  - `check-manual` — acp.preset-http-upload-manual pending manual attestation
  - `check-manual` — acp.runtime-flip-manual pending manual attestation
  - `check-manual` — acp.sidecar-manual pending manual attestation
  - `check-manual` — acp.plugin-sdk-collision-manual pending manual attestation
  - `check-manual` — acp.dispatch-pipeline-manual pending manual attestation
  - `check-manual` — acp.lifecycle-channel-manual pending manual attestation
  - `check-manual` — acp.pty-permission-manual pending manual attestation
  - `check-manual` — acp.prompt-tempfile-manual pending manual attestation
  - `check-manual` — acp.event-parsing-manual pending manual attestation
  - `check-manual` — acp.session-metadata-manual pending manual attestation
  - `check-manual` — acp.patched-shim-manual pending manual attestation
  - `check-manual` — mcp-bridge.gateway-bridge-manual pending manual attestation
  - `check-manual` — mcp-bridge.forge-live-manual pending manual attestation
  - `check-manual` — mcp-bridge.zoom-live-manual pending manual attestation
  - `check-manual` — mcp-bridge.lando-live-manual pending manual attestation
  - `check-manual` — mcp-bridge.lando-safety-manual pending manual attestation
  - `check-manual` — mcp-bridge.sanitizer-manual pending manual attestation
  - `check-manual` — attachments.large-parsing-manual pending manual attestation
  - `check-manual` — attachments.hostile-labels-manual pending manual attestation
  - `check-manual` — attachments.jsonl-mime-manual pending manual attestation
  - `check-manual` — model-provenance.opus-4-8-manual pending manual attestation
  - `check-manual` — model-provenance.opus-5-live-manual pending manual attestation
  - `check-manual` — model-provenance.sol-provider-path-manual pending manual attestation
  - `check-manual` — model-provenance.sol-atomic-send-manual pending manual attestation
  - `check-manual` — model-provenance.sol-thinking-reset-manual pending manual attestation
  - `check-manual` — model-provenance.acp-preset-manual pending manual attestation
  - `check-manual` — model-provenance.per-turn-model-manual pending manual attestation
  - `check-manual` — fallback-persistence.fallback-chain-manual pending manual attestation
  - `check-manual` — project-files.generation-manual pending manual attestation
  - `check-manual` — browser-isolation.per-project-manual pending manual attestation
  - `check-manual` — auth.oauth-refresh-dedupe-manual pending manual attestation
  - `check-manual` — auth.burned-profile-manual pending manual attestation
  - `check-manual` — auth.stale-refresh-manual pending manual attestation
  - `check-manual` — auth.acp-log-identity-manual pending manual attestation
  - `check-manual` — runtime-infra.macos-dep-rationale-manual pending manual attestation
  - `check-manual` — providers.generated-bundle-manual pending manual attestation
  - `check-manual` — providers.zap-baseline-manual pending manual attestation
  - `matrix-nonterminal` — 80 matrix row(s) are still in nonterminal states (assumed|test-only). No row may advance without matrix update.

## Summary by evidence class

| Class          | Count |
| -------------- | ----: |
| behavior PASS  |     7 |
| inventory PASS |    33 |
| evidence PASS  |     1 |
| FAIL           |     0 |
| SKIP           |     0 |
| MANUAL pending |    53 |
| TOTAL          |    94 |

> Inventory PASS asserts the source/config/file inventory only. It is NOT proof of the behavior itself.
> Evidence PASS attests to an immutable artifact for the current baseline; the target baseline requires a fresh artifact.

## Preservation matrix coverage

- Total matrix rows: **80**
- Terminal states: **0** · Nonterminal states: **80**
- Rows fully covered by this run: **80**
- Behavior/Inventory/Evidence PASS counts across matrix rows: **13** / **37** / **1**
- Manual pending: **58** · Failed: **0** · Skipped: **0**

## Environment (redacted)

```json
{
  "now": "2026-07-28T02:46:36.826Z",
  "node": "24.14.0",
  "platform": "linux",
  "arch": "arm64",
  "stateDir": "<redacted-path:.../node/.openclaw>",
  "repoRoot": "<redacted-path:.../host-projects/openclaw--openclaw>",
  "uiRoot": "<redacted-path:.../host-projects/openclaw--openclaw-ui>",
  "configPath": "<redacted-path:.../.openclaw/openclaw.json>",
  "workspaceDbPath": "<redacted-path:.../workspace/conversations.db>",
  "mountRegistryPath": "<redacted-path:.../.openclaw/mount-registry.json>",
  "mountBase": "/mnt/host-projects",
  "procMountsPath": "/proc/self/mounts",
  "gatewayUrl": "http://127.0.0.1:18789",
  "git": {
    "head": "a0cfa5090b00f1deeec9aef21f9a3a8e537d0d00",
    "branch": "test/upgrade-golden-master-contracts",
    "dirty": false,
    "dirtyFileCount": 0
  },
  "openClawJson": {
    "path": "<redacted-path:.../.openclaw/openclaw.json>",
    "version": "2026.4.2",
    "lastTouchedAt": "2026-07-27T13:03:48.201Z",
    "topLevelKeys": [
      "acp",
      "agents",
      "auth",
      "bindings",
      "browser",
      "canvasHost",
      "channels",
      "commands",
      "cron",
      "env",
      "gateway",
      "hooks",
      "logging",
      "mcp",
      "messages",
      "meta",
      "models",
      "plugins",
      "session",
      "skills",
      "tools",
      "ui",
      "update",
      "wizard"
    ],
    "agentListCount": 40,
    "mcpServerCount": 3,
    "mcpServerNames": ["forge", "gmail", "zoom"],
    "pluginsEnabled": true,
    "pluginSlots": {
      "memory": "memory-lancedb-project"
    },
    "pluginLoadPaths": ["<redacted-path:.../extensions/memory-lancedb-project>"],
    "pluginEntryIds": [
      "acpx",
      "browser",
      "memory-lancedb-project",
      "session-context-recovery",
      "slack",
      "transcript-archive"
    ],
    "pluginEntryStates": [
      {
        "id": "acpx",
        "enabled": true
      },
      {
        "id": "browser",
        "enabled": true
      },
      {
        "id": "memory-lancedb-project",
        "enabled": true
      },
      {
        "id": "session-context-recovery",
        "enabled": true
      },
      {
        "id": "slack",
        "enabled": true
      },
      {
        "id": "transcript-archive",
        "enabled": true
      }
    ],
    "enabledEntryIds": [
      "acpx",
      "browser",
      "memory-lancedb-project",
      "session-context-recovery",
      "slack",
      "transcript-archive"
    ],
    "disabledEntryIds": [],
    "stockMemoryPresent": false,
    "stockMemoryEnabled": false,
    "projectMemoryEnabled": true,
    "requiredModels": [
      {
        "id": "anthropic/claude-opus-4-8",
        "allowed": true,
        "providerDeclared": true
      },
      {
        "id": "anthropic/claude-opus-5",
        "allowed": true,
        "providerDeclared": true
      }
    ],
    "browserProfileCount": 7
  },
  "gateway": {
    "url": "http://127.0.0.1:18789",
    "status": 200,
    "body": {
      "ok": true,
      "status": "live"
    }
  },
  "mounts": {
    "path": "<redacted-path:.../.openclaw/mount-registry.json>",
    "totalRows": 35,
    "enabled": 33,
    "disabled": 2,
    "aliases": 1,
    "readOnly": 8,
    "readWrite": 27
  },
  "extensions": {
    "root": "<redacted-path:.../.openclaw/extensions>",
    "entries": ["memory-lancedb-project", "session-context-recovery", "transcript-archive"]
  },
  "mcpServers": {
    "root": "<redacted-path:.../.openclaw/mcp>",
    "entries": ["forge-mcp-server-patched", "zoom-mcp-server"]
  },
  "browser": {
    "path": "<redacted-path:.../.openclaw/browser-ports.json>",
    "profileCount": 25,
    "profileIds": [
      "4corner-ai",
      "4corner-resources",
      "4corner-select",
      "blue-bird-nest-lines",
      "blue-bird-nest-lines-2",
      "business-warrior",
      "desert-river-solutions",
      "kirkwood",
      "kirkwood-db",
      "lidar",
      "main",
      "main-agent",
      "mg-media",
      "mighty-tour",
      "openclaw",
      "opensupply",
      "opensupply-content-reg",
      "optum-group",
      "r2c",
      "rapid-fund-raising",
      "slater-floorin-and-design",
      "sunrail",
      "theory-time",
      "zengig",
      "zengig-laravel"
    ]
  },
  "workspaceDb": {
    "path": "<redacted-path:.../workspace/conversations.db>",
    "sizeBytes": 1061588992,
    "mtime": "2026-07-28T02:33:57.568Z"
  },
  "uiCheckpoint": {
    "path": "<redacted-path:.../host-projects/openclaw--openclaw-ui>",
    "isDirectory": true
  }
}
```

## Results

### MANUAL (pending) (53)

#### `memory-firewall.subagent-idempotency-manual` — Subagent announcement is idempotent; same subagent does not multi-register

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `memory-firewall`
- Matrix IDs: `UM-06c`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging session capable of triggering subagent announcement more than once.

_Steps:_

1. Force N=3 subagent announcements for the same subagent identity in rapid succession.
2. Inspect the runtime state to confirm the subagent registers exactly once.

_Expected:_ Only one subagent record exists after the repeated announcements.

_Evidence to capture:_

- Runtime state before/after; subagent registry snapshot.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: false
- writesWorkspaceFiles: false
- expectedMutations: `one subagent registry entry`
- cleanupRollback: `deregister the canary subagent after verification`
- evidenceCapture: `registry snapshot`, `state diff`

────────────────────────────────────────────────────────────────────────

#### `memory-firewall.target-runtime-manual` — Target runtime canary evidence artifact must be produced fresh; current baseline does NOT count

- Status: **manual** · kind: `evidence` · duration: 0ms
- Groups: `memory-firewall`
- Matrix IDs: `MEM-01`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- The target-runtime canary artifact directory (fresh timestamp) with a SHA256SUMS manifest and live-canary-result.json produced against the target runtime.
- The manifest MUST NOT reuse the current baseline directory memory-firewall-20260727-125533; a new UPGRADE_CHECKPOINT is required.

_Steps:_

1. Rerun the canary suite against the target runtime.
2. Publish the new artifact directory under ~/.<redacted:entropy><target-ts>/ with SHA256SUMS.
3. Point the target-runtime evidence checker at the new path.

_Expected:_ A fresh evidence directory exists with 13-assertion PASS and zero residual rows for the TARGET runtime.

_Evidence to capture:_

- New artifact directory path and manifest SHA256s.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `target-runtime canary rows created and deleted`
- cleanupRollback: `delete every UUID-tagged canary row`, `verify residual==0`
- evidenceCapture: `new artifact directory`, `manifest SHA256s`

────────────────────────────────────────────────────────────────────────

#### `mounts-permissions.host-mount-access-manual` — Host-mount access enforces RO/RW per registry (staging RW canary)

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `mounts-permissions`
- Matrix IDs: `UM-04a`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Live gateway container with reconciled 32-FUSE baseline.
- Explicit staging/safe-live opt-in from Marc; the RW canary is a reserved UUID tag and the harness will clean it up.

_Steps:_

1. For each RO row (openclaw-mount list --ro), attempt to touch /mnt/host-projects/<name>/.canary-<uuid>; capture stderr.
2. For one RW row explicitly authorized as the RW canary target, touch a canary file and immediately delete it in the same step.
3. Confirm every RO attempt fails and the single RW attempt succeeds and is cleaned up.

_Expected:_ Every RO attempt fails EROFS or equivalent. Exactly one RW target permits the write and the canary is removed. No canary files remain after the test.

_Evidence to capture:_

- Touch commands, exit codes, and errno messages.
- Post-test ls confirming no canary files remain.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- writesWorkspaceFiles: true
- expectedMutations: `single RW canary file created and immediately deleted`
- cleanupRollback: `rm the RW canary in the same step`, `assert file does not exist post-test`
- evidenceCapture: `command outputs`, `ls confirming cleanup`

────────────────────────────────────────────────────────────────────────

#### `mounts-permissions.container-setup-manual` — Container mount setup preserves ro/rw + reconnect + IPv4

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `mounts-permissions`, `runtime-infra`
- Matrix IDs: `UM-26`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging image built from Dockerfile.mountfix.
- Ability to snapshot /proc/self/mounts before and after start.

_Steps:_

1. Boot the staging image; wait for openclaw-mount-restore to complete.
2. Capture /proc/self/mounts and diff it against the reconciled baseline.
3. Assert every mount uses ssh_command=ssh -4 and reconnect,ServerAliveInterval=15.

_Expected:_ All enabled rows mount with correct ro/rw, IPv4 transport, and reconnect. No extra mounts, no failed rows.

_Evidence to capture:_

- Diff vs reconciled baseline; openclaw-mount-restore log excerpt.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging-only boot; no cleanup on live`
- evidenceCapture: `diff`, `log excerpt`

────────────────────────────────────────────────────────────────────────

#### `history-recovery.large-history-manual` — Large session histories are served without truncation or crash

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `history-recovery`
- Matrix IDs: `UM-08b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging session with thousands of messages; sufficient memory allocation.

_Steps:_

1. Fetch the full history for the session.
2. Confirm no OOM and no dropped messages.

_Expected:_ Full-history fetch completes; message count matches JSONL row count.

_Evidence to capture:_

- Message count comparison; memory usage snapshot.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `read-only test`
- evidenceCapture: `message count`, `memory snapshot`

────────────────────────────────────────────────────────────────────────

#### `history-recovery.post-compaction-manual` — Context recovers correctly after compaction

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `history-recovery`
- Matrix IDs: `UM-05b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging session close to the compaction threshold.
- The session-context-recovery extension enabled.

_Steps:_

1. Trigger compaction.
2. Ask the agent to summarize what happened before the compaction cut-off.
3. Verify the pre-compaction transcript is retained under ~/.openclaw/workspace/ui-transcripts/.

_Expected:_ Agent references specific facts from pre-compaction turns; transcripts persist without loss.

_Evidence to capture:_

- Full response transcript; pre-/post-compaction JSONL and ui-transcript file names.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `compaction summary and updated transcript`
- cleanupRollback: `staging-only`
- evidenceCapture: `transcript`, `file names`

────────────────────────────────────────────────────────────────────────

#### `history-recovery.compaction-quality-manual` — Repeated compactions are idempotent and do not amplify content

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `history-recovery`
- Matrix IDs: `UM-06b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging session that can be compacted twice in a row without new turns.

_Steps:_

1. Compact the session.
2. Immediately trigger another compaction.
3. Verify the second compaction is a no-op or a bounded refinement (no content amplification).

_Expected:_ Second compaction is idempotent within a documented bound.

_Evidence to capture:_

- Compaction outputs from both attempts.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `two compaction turns`
- cleanupRollback: `staging-only`
- evidenceCapture: `compaction outputs`

────────────────────────────────────────────────────────────────────────

#### `history-recovery.workspace-limits-manual` — Workspace bootstrap prompts honor per-agent limits and do not spill cross-agent data

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `history-recovery`
- Matrix IDs: `UM-06d`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging workspace with multiple agents and distinct workspace-scoped files.

_Steps:_

1. Boot agent A; capture its workspace bootstrap prompt.
2. Boot agent B; capture its workspace bootstrap prompt.
3. Verify B's bootstrap does not include A's workspace files.

_Expected:_ Bootstrap prompts are scoped per-agent; no cross-agent spill.

_Evidence to capture:_

- Redacted bootstrap prompts for both agents.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `read-only`
- evidenceCapture: `bootstrap prompts`

────────────────────────────────────────────────────────────────────────

#### `history-recovery.codex-overflow-manual` — Codex context overflow triggers auto-compaction

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `history-recovery`
- Matrix IDs: `UM-24`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging Codex session and a large synthetic input that exceeds the provider's context.

_Steps:_

1. Send the oversize input.
2. Observe the gateway log for the classification path.
3. Confirm auto-compaction runs and the next turn completes.

_Expected:_ Overflow is classified, auto-compaction runs, and the follow-up turn returns a completed response.

_Evidence to capture:_

- Gateway log lines; turn-completion transcript with compaction summary reference.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `one compaction turn`
- cleanupRollback: `staging-only`
- evidenceCapture: `log lines`, `transcript`

────────────────────────────────────────────────────────────────────────

#### `transcript-archive.injection-manual` — Transcript injection retains prior turns after runtime flip

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `transcript-archive`
- Matrix IDs: `UM-08d`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging session with several assistant turns.
- Ability to trigger a runtime flip (ACP <-> embedded).

_Steps:_

1. Record the last three assistant turns from the current staging session.
2. Trigger a runtime flip.
3. Ask the agent to summarize what it said in the previous three turns.

_Expected:_ Post-flip agent references pre-flip turns via transcript injection without loss of ordering.

_Evidence to capture:_

- Full pre- and post-flip transcript excerpts; session-log NDJSON showing injection payload.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `one staging summary turn`
- cleanupRollback: `staging-only`
- evidenceCapture: `transcript excerpts`, `NDJSON`

────────────────────────────────────────────────────────────────────────

#### `streaming-cleanup.terminal-cleanup-manual` — Terminal cleanup clears refs on every completion path

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `streaming-cleanup`
- Matrix IDs: `UI-03b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A running UI session with the checkpoint UI build.
- Ability to drive normal send, edit, retry, abort, timeout, and HTTP file paths.

_Steps:_

1. Send a normal WS message; on final, capture window.\_\_openclaw_debug refs (sendingRef, runStartedAtRef, activeRunRef).
2. Send with an attachment via HTTP; capture the same refs.
3. Trigger a user abort mid-run.
4. Trigger a stall auto-abort by delaying tool completion beyond the timeout.
5. Trigger an error final by sending an invalid model id.
6. Trigger a session-mismatch final by rehydrating a stale sessionKey.

_Expected:_ After each terminal path all three refs are cleared; RunStatusIndicator elapsed time resets; no lingering 'Writing…' state.

_Evidence to capture:_

- Screenshot or DOM dump of RunStatusIndicator after each terminal path.
- The ref values captured immediately after final.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: `staging chat turns and abort states`
- cleanupRollback: `staging-only session`
- evidenceCapture: `screenshots`, `ref dumps`

────────────────────────────────────────────────────────────────────────

#### `streaming-cleanup.empty-final-manual` — Empty final-turn recovery still terminates cleanly

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `streaming-cleanup`, `history-recovery`
- Matrix IDs: `UM-28a`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A live staging session on Codex or another provider prone to empty final turns.
- Sufficient staging balance for one conservative wrap-up prompt.

_Steps:_

1. Trigger the known empty-final path (successful tool work with no assistant text).
2. Observe the runner emits exactly one wrap-up prompt.
3. Confirm the UI transitions to Idle after the wrap-up prompt lands.

_Expected:_ The wrap-up prompt runs at most once, the UI reaches Idle, and the transcript records the recovered final turn.

_Evidence to capture:_

- Runner log excerpt showing the wrap-up trigger.
- Final transcript row proving the recovered response.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `one wrap-up prompt turn and its transcript row`
- cleanupRollback: `staging-only`
- evidenceCapture: `runner log`, `transcript row`

────────────────────────────────────────────────────────────────────────

#### `streaming-cleanup.wrap-up-idempotent-manual` — Wrap-up is idempotent; duplicate wrap-ups do not incur double billing/persistence

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `streaming-cleanup`, `history-recovery`
- Matrix IDs: `UM-28b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging session prone to empty final; ability to observe billing/persistence side-effects.

_Steps:_

1. Force a second wrap-up attempt (simulate a reconnect/duplicate trigger).
2. Verify the second wrap-up is suppressed.
3. Verify only one billed API call and one transcript row exist for the wrap-up.

_Expected:_ Second wrap-up is suppressed; single billing / single row persisted.

_Evidence to capture:_

- Billing snapshot; transcript row count.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `one billed wrap-up turn`
- cleanupRollback: `staging-only`
- evidenceCapture: `billing snapshot`, `row count`

────────────────────────────────────────────────────────────────────────

#### `streaming-cleanup.ghost-stream-manual` — Ghost Stream (dead reconnect loop) is bounded and does not persist

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `streaming-cleanup`
- Matrix IDs: `UI-03c`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Ability to force disconnect and re-connect the UI to the gateway.

_Steps:_

1. Force a disconnect during an active run.
2. Rehydrate the session; verify the UI does not enter a reconnect flood.
3. Confirm the current-run tool count remains accurate across the reconnect.

_Expected:_ No reconnect flood; accurate current-run tool count.

_Evidence to capture:_

- WebSocket reconnect log; tool-count snapshot.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging-only`
- evidenceCapture: `reconnect log`, `tool-count snapshot`

────────────────────────────────────────────────────────────────────────

#### `two-tab-scoping.session-scoping-manual` — Two tabs on the same session do not cross events

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `two-tab-scoping`
- Matrix IDs: `TT-01`, `UI-03c`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Two browser tabs on the same staging UI attached to identical projectId + sessionKey.
- A third tab on a different session for negative control.

_Steps:_

1. Send a message from tab A.
2. Confirm tab B receives streaming events for the same run.
3. Confirm the negative-control tab receives no events.
4. Send a message from tab B; assert the same fan-out.
5. Close tab A; send from tab B and confirm no dead reconnection loop.

_Expected:_ Both same-session tabs stream identical events; negative-control tab receives no events; no reconnect flood after close.

_Evidence to capture:_

- Per-tab WebSocket frame captures; gateway log excerpt showing per-connection dispatch scoping.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: `staging turns from both tabs`
- cleanupRollback: `staging-only`
- evidenceCapture: `frame captures`, `log excerpt`

────────────────────────────────────────────────────────────────────────

#### `steering.mid-run-manual` — Mid-run steering redirects the active turn without losing state

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `steering`
- Matrix IDs: `UM-03`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging session where the agent is executing a long tool call.
- The UI steering input available.

_Steps:_

1. Start a long-running tool call on staging.
2. Submit a steering message that modifies the goal.
3. Observe the agent adopting the new goal without duplicating tool events.

_Expected:_ The agent adopts the new goal; prior tool events remain visible; no duplicate final turn.

_Evidence to capture:_

- Chat transcript showing pre-steering tool events and steering-message boundary.
- Gateway log excerpt showing steering-event delivery.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `one staging turn with steering`
- cleanupRollback: `staging-only`
- evidenceCapture: `transcript`, `log excerpt`

────────────────────────────────────────────────────────────────────────

#### `acp.preset-http-upload-manual` — HTTP upload accepts ACP preset models

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `acp`, `attachments`
- Matrix IDs: `UM-01`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Live gateway session and a small HTTP file-upload attachment prepared for staging.
- A valid ACP preset id from the current preset catalog.

_Steps:_

1. Upload a small text file with the preset model id set via HTTP.
2. Confirm the gateway accepts the upload and echoes the resolved model.

_Expected:_ The upload completes and the resolved model equals the preset's underlying model id.

_Evidence to capture:_

- Full HTTP response body and gateway log excerpt showing normalization.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `one uploaded text file in staging workspace`
- cleanupRollback: `delete uploaded file after verification`
- evidenceCapture: `response body`, `gateway log excerpt`

────────────────────────────────────────────────────────────────────────

#### `acp.runtime-flip-manual` — ACP runtime flip preserves context, session log, and subagent identity

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `acp`
- Matrix IDs: `UM-03`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A live staging session with both ACP and embedded runtimes available.
- A canary subagent identity established before the flip.

_Steps:_

1. Send a turn on ACP; record the NDJSON session log line.
2. Flip to embedded; send a follow-up turn.
3. Flip back to ACP; ask the agent to recall the canary subagent identity.

_Expected:_ No duplicated messages; session log records each transition; subagent identity survives both flips.

_Evidence to capture:_

- Session log NDJSON excerpt; chat transcript excerpts around both flips.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `session log lines and canary subagent identity`
- cleanupRollback: `retire canary subagent identity after test`
- evidenceCapture: `NDJSON excerpt`, `transcript excerpts`

────────────────────────────────────────────────────────────────────────

#### `acp.sidecar-manual` — ACP NDJSON sidecar persists per-turn metadata

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `acp`
- Matrix IDs: `UM-04b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A live ACP session and access to ~/.openclaw/agents/<agent>/sessions/<session>.jsonl.

_Steps:_

1. Send a turn.
2. Inspect the NDJSON sidecar for the turn.
3. Verify runtime, model, and thinking effort metadata is present.

_Expected:_ The sidecar has one JSON line per turn with runtime, model, and effort fields populated.

_Evidence to capture:_

- The exact JSONL lines for the turn.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `one JSONL line in staging session log`
- cleanupRollback: `staging-only; no rollback of session log lines needed`
- evidenceCapture: `JSONL lines`

────────────────────────────────────────────────────────────────────────

#### `acp.plugin-sdk-collision-manual` — ACP plugin-sdk exports do not collide with core internals

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `acp`
- Matrix IDs: `UM-04c`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Ability to load the plugin-sdk barrel and diff exports against src/acp core internals.

_Steps:_

1. Compare exported names from openclaw/plugin-sdk/acp with src/acp internals.
2. Verify no third-party plugin can import a core internal through the sdk barrel by name.

_Expected:_ The public surface is a narrow, documented subset. No internal-only symbol is re-exported.

_Evidence to capture:_

- Diff of the SDK barrel exports vs the core internals; test import from a third-party stub.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `observational only`
- evidenceCapture: `diff output`

────────────────────────────────────────────────────────────────────────

#### `acp.dispatch-pipeline-manual` — ACP dispatch pipeline delivers events without duplication

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `acp`
- Matrix IDs: `UM-05a`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A live ACP session and the UI streaming view.

_Steps:_

1. Trigger a turn with tool events.
2. Compare gateway-emitted events with UI-rendered events.
3. Trigger post-compaction context injection; verify projection order.

_Expected:_ 1:1 mapping between gateway events and UI events; post-compaction ordering preserved.

_Evidence to capture:_

- Event log capture from both sides.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `one staging turn with tool events`
- cleanupRollback: `staging-only; retain events for evidence`
- evidenceCapture: `event captures`

────────────────────────────────────────────────────────────────────────

#### `acp.lifecycle-channel-manual` — ACP lifecycle commands terminate cleanly across every configured messaging channel

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `acp`
- Matrix IDs: `UM-05c`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- For each configured channel (webchat, Slack, Telegram, Discord, Signal, iMessage, WhatsApp web, Matrix, Zalo, Voice Call as applicable), a staging session or dry-run harness.

_Steps:_

1. Issue an ACP lifecycle command (start/stop/reset).
2. Verify each configured channel reflects the terminal state.

_Expected:_ Every channel reaches the terminal state consistently; no lingering runs.

_Evidence to capture:_

- Per-channel state snapshots after the command.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: false
- changesAuth: false
- downloadsExternal: false
- writesWorkspaceFiles: false
- externalMessaging: false
- expectedMutations: `lifecycle state changes`
- cleanupRollback: `staging-only; restart is not permitted by this harness`
- evidenceCapture: `state snapshots`

────────────────────────────────────────────────────────────────────────

#### `acp.pty-permission-manual` — ACPX PTY spawn and permission policy behave as documented

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `acp`
- Matrix IDs: `UM-10a`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A live ACPX session where permission prompts are enabled.

_Steps:_

1. Trigger a tool that requires approval.
2. Approve it; verify the tool runs.
3. Trigger a tool that requires approval; deny it; verify it does not run.

_Expected:_ Approval gates operate as expected; PTY spawn does not leak to a shared TTY.

_Evidence to capture:_

- Screenshots of the approval prompt and the deny path.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: `one tool invocation on approve; nothing on deny`
- cleanupRollback: `staging-only; roll back any tool side-effect`
- evidenceCapture: `screenshots`

────────────────────────────────────────────────────────────────────────

#### `acp.prompt-tempfile-manual` — ACPX prompt-tempfile transport cleans up and honors noninteractive policy

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `acp`
- Matrix IDs: `UM-10b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging ACPX session with a large prompt that triggers the tempfile path.

_Steps:_

1. Send a large prompt; observe tempfile creation and cleanup after the turn.
2. Verify path safety (no traversal, no shared tmp).
3. Repeat in noninteractive mode; confirm noninteractive-policy behavior.

_Expected:_ Tempfile is created in an isolated path, cleaned up post-turn, and noninteractive policy is honored.

_Evidence to capture:_

- Tempfile path listing before/after; noninteractive session output.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- writesWorkspaceFiles: true
- expectedMutations: `one tempfile created and deleted`
- cleanupRollback: `assert tempfile removed after turn`
- evidenceCapture: `path listings`, `session output`

────────────────────────────────────────────────────────────────────────

#### `acp.event-parsing-manual` — ACPX expanded event parsing tolerates duplicate/unknown events; process cleanup on exit

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `acp`, `streaming-cleanup`
- Matrix IDs: `UM-10c`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging ACPX session with the ability to inject duplicate/unknown NDJSON lines.

_Steps:_

1. Inject one duplicate event and one unknown-type event during a turn.
2. Confirm the runtime does not crash and the turn completes.
3. Exit the session; verify process cleanup releases child processes.

_Expected:_ Turn completes; no zombie processes remain after exit.

_Evidence to capture:_

- Turn transcript; ps snapshot before/after exit.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `ps snapshot proves cleanup`
- evidenceCapture: `transcript`, `ps snapshots`

────────────────────────────────────────────────────────────────────────

#### `acp.session-metadata-manual` — Session metadata records ACP runtime information

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `acp`, `history-recovery`
- Matrix IDs: `UM-11`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A live ACP session and read access to session metadata.

_Steps:_

1. Retrieve session metadata for the current run.
2. Confirm the ACP runtime, model, and thinking effort are present.

_Expected:_ Metadata contains the ACP runtime, model, and effort fields.

_Evidence to capture:_

- Metadata JSON payload.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `read-only; no rollback`
- evidenceCapture: `metadata payload`

────────────────────────────────────────────────────────────────────────

#### `acp.patched-shim-manual` — Patched Claude ACP shim is bind-mounted and active

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `acp`
- Matrix IDs: `RT-07`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Host filesystem access with the patched claude-agent-acp-local directory.

_Steps:_

1. Verify the compose file bind-mounts the patched shim path.
2. From inside the container, resolve the shim's entry file and check for the systemPrompt.append patch.

_Expected:_ Container uses the patched shim; the patch is present and matches the recovery-archive checksum.

_Evidence to capture:_

- File checksum comparison against the recovery archive.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `observational only`
- evidenceCapture: `checksum comparison`

────────────────────────────────────────────────────────────────────────

#### `mcp-bridge.gateway-bridge-manual` — Gateway-bridge MCP exposes OpenClaw tools inside ACP

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `mcp-bridge`
- Matrix IDs: `UM-09`, `UM-25`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging ACP session with the gateway-bridge MCP enabled.

_Steps:_

1. List tools inside the ACP session.
2. Invoke one OpenClaw tool (e.g. memory_recall) through the bridge.
3. Trigger a name-collision path by installing a same-named tool on both sides; verify sanitization.

_Expected:_ OpenClaw tools appear inside the ACP tool list; collisions are sanitized without swallowing calls.

_Evidence to capture:_

- Full tool list; bridged tool response; sanitizer log excerpt.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: `one bridged tool call`
- cleanupRollback: `staging-only`
- evidenceCapture: `tool list`, `response`, `log excerpt`

────────────────────────────────────────────────────────────────────────

#### `mcp-bridge.forge-live-manual` — Forge MCP responds and redacts environment retrieval

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `mcp-bridge`
- Matrix IDs: `RT-04`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging Forge MCP configured and reachable.
- A Forge action that reads environment values.

_Steps:_

1. Invoke the environment-reading action against staging.
2. Inspect the response for any raw secret leakage.

_Expected:_ Response returns redacted values; no plaintext token leaves the container.

_Evidence to capture:_

- Redacted response body and Forge server log excerpt.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `read-only`
- evidenceCapture: `response`, `log excerpt`

────────────────────────────────────────────────────────────────────────

#### `mcp-bridge.zoom-live-manual` — Zoom MCP tool set responds via configured OAuth

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `mcp-bridge`
- Matrix IDs: `RT-05`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging Zoom MCP configured with valid OAuth.

_Steps:_

1. Invoke a read-only Zoom action (e.g. list meetings).
2. Verify the response is authenticated and correctly scoped.

_Expected:_ The read-only Zoom call succeeds without a re-auth prompt.

_Evidence to capture:_

- Truncated Zoom API response (redacted).

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: true
- changesAuth: false
- downloadsExternal: false
- writesWorkspaceFiles: false
- externalMessaging: false
- expectedMutations: none
- cleanupRollback: `read-only`
- evidenceCapture: `response`

────────────────────────────────────────────────────────────────────────

#### `mcp-bridge.lando-live-manual` — Lando MCP performs a safe read-only action

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `mcp-bridge`
- Matrix IDs: `UM-16a`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging Lando MCP configured with a project the operator is allowed to inspect.

_Steps:_

1. Invoke lando list / status (never a destructive one).
2. Verify no lifecycle command runs without explicit confirmation.

_Expected:_ Read-only calls succeed; destructive ops still require explicit confirmation.

_Evidence to capture:_

- Redacted MCP response body.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `read-only`
- evidenceCapture: `response`

────────────────────────────────────────────────────────────────────────

#### `mcp-bridge.lando-safety-manual` — Lando MCP enforces safe quoting, containment, timeouts, and destructive-confirmation

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `mcp-bridge`
- Matrix IDs: `UM-16b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging Lando MCP and a project whose lifecycle can be exercised safely.

_Steps:_

1. Attempt a command with shell-metacharacters in an argument; confirm quoting rejects it.
2. Attempt a slow-running command past the configured timeout; confirm timeout enforced.
3. Attempt a destructive op; confirm explicit confirmation is required.

_Expected:_ Every safety invariant is honored; nothing destructive proceeds without confirmation.

_Evidence to capture:_

- Command outputs; timeout log; confirmation prompt capture.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging-only`
- evidenceCapture: `outputs`, `log`, `prompt capture`

────────────────────────────────────────────────────────────────────────

#### `mcp-bridge.sanitizer-manual` — MCP tool-name sanitizer prevents collisions

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `mcp-bridge`
- Matrix IDs: `UM-25`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging MCP server registering a tool with the same name as an OpenClaw built-in.

_Steps:_

1. Register the colliding tool.
2. List tools; verify the collision was renamed.
3. Invoke both tools; verify they route to the correct handler.

_Expected:_ Sanitizer renames the colliding tool and preserves both handlers.

_Evidence to capture:_

- Tool list showing renamed entry and both responses.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging-only`
- evidenceCapture: `tool list`, `responses`

────────────────────────────────────────────────────────────────────────

#### `attachments.large-parsing-manual` — Large attachment parsing is bounded and returns structured offloadedRefs

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `attachments`
- Matrix IDs: `UM-22a`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging gateway session.
- Sample PDF, DOCX, JSONL, unknown-binary, and >10 MB image files staged locally.

_Steps:_

1. Upload each file type via both WebSocket and HTTP transports.
2. Inspect the returned message payload for offloadedRefs entries with path, mime, label, size.
3. Have the agent invoke a read tool against the offloaded path; verify content accessibility.

_Expected:_ Every non-image accepted file produces a structured OffloadedRef; agent can read via the returned path.

_Evidence to capture:_

- offloadedRefs JSON for each upload.
- Read-tool response for each file.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `one offloaded file per upload`
- cleanupRollback: `delete uploaded files after verification`
- evidenceCapture: `offloadedRefs`, `read responses`

────────────────────────────────────────────────────────────────────────

#### `attachments.hostile-labels-manual` — Hostile labels/limits are refused with a bounded error; order preserved

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `attachments`
- Matrix IDs: `UM-22b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging gateway with sample malformed uploads.

_Steps:_

1. Upload files with path-traversal labels, oversized labels, and null-byte labels.
2. Verify each is refused with a documented error, not a crash.
3. Verify order of operations places validation before persistence.

_Expected:_ Malicious inputs are refused with bounded errors; no persistence side-effects on refuse.

_Evidence to capture:_

- Error responses; server log excerpt showing validation order.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging-only`
- evidenceCapture: `error responses`, `log excerpt`

────────────────────────────────────────────────────────────────────────

#### `attachments.jsonl-mime-manual` — JSONL upload is accepted end-to-end

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `attachments`
- Matrix IDs: `UM-12`, `CP-03`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging gateway session and a small JSONL sample file.

_Steps:_

1. Upload the JSONL via HTTP.
2. Have the agent invoke a read tool on the offloaded path.

_Expected:_ The upload is accepted, the offloadedRef is present, and the agent can read line by line.

_Evidence to capture:_

- Full upload response and read-tool output.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `one uploaded JSONL`
- cleanupRollback: `delete uploaded file after verification`
- evidenceCapture: `response`, `read output`

────────────────────────────────────────────────────────────────────────

#### `model-provenance.opus-4-8-manual` — Opus 4.8 dispatch echoes the real active model

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `model-provenance`
- Matrix IDs: `MODEL-02`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging Anthropic account balance for the current window.
- The Opus 4.8 selector visible in the UI.

_Steps:_

1. Select Opus 4.8 in the UI.
2. Send a short prompt asking the model to echo its model id.
3. Inspect the response metadata and the API log for the returned model id.

_Expected:_ Response metadata identifies claude-opus-4-8; no silent fallback.

_Evidence to capture:_

- Truncated response metadata.
- API log line with the response model id.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging balance only`
- evidenceCapture: `metadata`, `API log`

────────────────────────────────────────────────────────────────────────

#### `model-provenance.opus-5-live-manual` — Opus 5 dispatch is either supported or fails visibly

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `model-provenance`
- Matrix IDs: `MODEL-03`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging Anthropic account balance and Opus 5 access.

_Steps:_

1. Select a preset that references claude-opus-5 (canonical form only).
2. Send a short prompt.
3. Confirm the response identifies claude-opus-5 or the request fails with a visible error.

_Expected:_ Silent fallback is impossible.

_Evidence to capture:_

- Response metadata and error banner (if any).

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging balance only`
- evidenceCapture: `metadata`, `banner`

────────────────────────────────────────────────────────────────────────

#### `model-provenance.sol-provider-path-manual` — SOL 5.6 dispatch resolves to the correct provider path

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `model-provenance`
- Matrix IDs: `MODEL-01`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Both openai-codex/gpt-5.6-sol and openai/gpt-5.6-sol paths configured in staging openclaw.json.

_Steps:_

1. Select SOL 5.6 High in the UI.
2. Send a prompt.
3. Inspect the response metadata for the actual provider id used.

_Expected:_ Response metadata identifies the intended SOL provider path; no silent GPT-5.5 fallback.

_Evidence to capture:_

- Truncated response metadata.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging balance only`
- evidenceCapture: `metadata`

────────────────────────────────────────────────────────────────────────

#### `model-provenance.sol-atomic-send-manual` — SOL 5.6 model + thinking effort atomic across WS/HTTP/edit/retry

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `model-provenance`
- Matrix IDs: `UI-02a`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging UI checkpoint build with SOL presets enabled.

_Steps:_

1. Send a WS message with SOL High selected; verify payload includes both model and thinking.
2. Repeat via HTTP file upload.
3. Edit and resend the message.
4. Retry from the error state.

_Expected:_ In every path the resolved model id AND thinking effort are carried together; moving to Base clears prior effort.

_Evidence to capture:_

- WebSocket / HTTP request captures for each path.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging balance only`
- evidenceCapture: `request captures`

────────────────────────────────────────────────────────────────────────

#### `model-provenance.sol-thinking-reset-manual` — SOL Base resets prior thinking; fallback exclusion for Off; ExtraHigh-Pro roundtrip; config rollback

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `model-provenance`
- Matrix IDs: `UI-02b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging UI with SOL presets; ability to inspect params.thinking per send.

_Steps:_

1. Select SOL High; send a turn (thinking=high).
2. Switch to SOL Base; send another turn.
3. Verify the new turn's params.thinking is a documented reset value (not stale high).
4. Switch to SOL Off; verify Off is excluded from fallback chain.
5. Roundtrip SOL ExtraHigh -> Pro -> ExtraHigh; verify each dispatch carries the correct pair.
6. Roll back to the prior config; verify the send behavior returns to baseline.

_Expected:_ Base clears the prior effort; Off is not selected as a fallback; ExtraHigh-Pro roundtrip preserves identity; rollback returns to baseline.

_Evidence to capture:_

- Request payloads and session config snapshots for each step.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- invokesPaidApi: true
- writesWorkspaceFiles: true
- expectedMutations: `staging session config toggles`
- cleanupRollback: `restore original session config after test`
- evidenceCapture: `payloads`, `config snapshots`

────────────────────────────────────────────────────────────────────────

#### `model-provenance.acp-preset-manual` — ACP preset routing echoes the resolved model on every path

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `model-provenance`
- Matrix IDs: `UM-02`, `UM-21`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Live staging ACP session with a valid preset selected.

_Steps:_

1. Send a prompt via the UI.
2. Send a prompt via HTTP.
3. Send an edit/resend and a retry.

_Expected:_ Every route reports the same resolved model in response metadata; no SDK-default fallback.

_Evidence to capture:_

- Response metadata for each path.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging balance only`
- evidenceCapture: `metadata`

────────────────────────────────────────────────────────────────────────

#### `model-provenance.per-turn-model-manual` — Per-turn model selection is honored end-to-end and reported in response metadata

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `model-provenance`
- Matrix IDs: `UM-08c`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging session with distinct model per turn.

_Steps:_

1. Send turn 1 with model A; verify metadata identifies A.
2. Send turn 2 with model B in the same session; verify metadata identifies B.
3. Retry turn 1 while turn 2 was already sent; verify model A on the retry.

_Expected:_ Each turn's response metadata reports the requested model; per-turn choice is stable.

_Evidence to capture:_

- Response metadata for all three turns.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging balance only`
- evidenceCapture: `metadata`

────────────────────────────────────────────────────────────────────────

#### `fallback-persistence.fallback-chain-manual` — Cross-provider fallback chain honors persisted ordering, cooldown, and death-spiral breaker

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `fallback-persistence`, `model-provenance`
- Matrix IDs: `RUN-01`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Staging session with a documented misconfigured primary model and >=2 fallback models.

_Steps:_

1. Send a prompt; observe the primary fails.
2. Verify the fallback chain fires in the persisted order.
3. Trigger a cooldown / death-spiral condition; verify the breaker engages.

_Expected:_ Fallback ordering, cooldown, and breaker all behave per documented spec.

_Evidence to capture:_

- Runner log excerpt across the failover; fallback ordering snapshot from projectApi.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- invokesPaidApi: true
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `staging-only`
- evidenceCapture: `log excerpt`, `ordering snapshot`

────────────────────────────────────────────────────────────────────────

#### `project-files.generation-manual` — PROJECT.md and PROJECT_FILES.md generation flow

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `project-files`
- Matrix IDs: `PF-01`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- UI checkpoint build.
- A staging workspace directory with at least three source files.

_Steps:_

1. Trigger PROJECT.md generation from the UI project view.
2. Verify the output matches the workspace snapshot.
3. Trigger PROJECT_FILES.md generation.
4. Verify each referenced file exists and the file list ordering matches the UI's chosen scope.

_Expected:_ Both files are generated to the expected paths and reflect the workspace snapshot.

_Evidence to capture:_

- Generated file contents (truncated).
- Workspace directory listing at generation time.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- writesWorkspaceFiles: true
- expectedMutations: `PROJECT.md and PROJECT_FILES.md in staging workspace`
- cleanupRollback: `delete generated files after verification`
- evidenceCapture: `file contents`, `directory listing`

────────────────────────────────────────────────────────────────────────

#### `browser-isolation.per-project-manual` — Per-project Chrome containers isolate cookies and downloads

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `browser-isolation`
- Matrix IDs: `RT-06`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- browser-manager.sh available
- Two staging projects with browser profiles configured

_Steps:_

1. Start browser for staging project A; log into a distinct account or site.
2. Start browser for staging project B; open the same site.
3. Confirm project B does NOT inherit project A's session.
4. Download a file in project A; confirm it lands in the project A downloads directory only.
5. Stop and restart project A's browser; confirm the session persists.

_Expected:_ Sessions and downloads are strictly isolated per project; data survives a container restart.

_Evidence to capture:_

- Screenshots; per-project downloads directory listing.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- writesWorkspaceFiles: true
- downloadsExternal: true
- expectedMutations: `staging profile mutations; one downloaded canary file`
- cleanupRollback: `delete downloaded canary file`
- evidenceCapture: `screenshots`, `directory listing`

────────────────────────────────────────────────────────────────────────

#### `auth.oauth-refresh-dedupe-manual` — Concurrent OAuth refresh requests are deduplicated

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `auth`
- Matrix IDs: `UM-07`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging provider whose access token is close to expiry.

_Steps:_

1. Fire two concurrent staging runs that will each trigger a refresh.
2. Inspect the OAuth server logs / gateway logs for the number of refresh calls.

_Expected:_ Exactly one refresh call is issued across both concurrent runs.

_Evidence to capture:_

- Redacted log excerpts from both sides.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- changesAuth: true
- invokesPaidApi: true
- expectedMutations: `one refresh token rotation on staging profile`
- cleanupRollback: `confirm profile is not burned; observe re-runnable state`
- evidenceCapture: `log excerpts`

────────────────────────────────────────────────────────────────────────

#### `auth.burned-profile-manual` — Permanent refresh failures retire the burned profile

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `auth`
- Matrix IDs: `UM-18`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A dedicated test OAuth profile with a deliberately invalid refresh token.

_Steps:_

1. Trigger a refresh; observe the permanent-failure classification.
2. Confirm the profile is marked burned and the UI prompts for reauth.
3. Confirm no further refresh attempts are made until the operator reauthenticates the test profile through the normal UI flow (never by hand-editing credentials).

_Expected:_ Permanent failures retire the profile; transient failures do not.

_Evidence to capture:_

- Gateway log excerpt and profile-state snapshot.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- changesAuth: true
- invokesPaidApi: false
- writesWorkspaceFiles: false
- expectedMutations: `burned state on test profile`
- cleanupRollback: `reauth test profile through UI to restore state`
- evidenceCapture: `log excerpt`, `profile snapshot`

────────────────────────────────────────────────────────────────────────

#### `auth.stale-refresh-manual` — Stale on-disk credential is adopted before declaring the token burned

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `auth`
- Matrix IDs: `UM-23`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Two staging agents sharing a provider profile.
- A documented UI/tooling path that rotates the on-disk credential (never a hand-edit of live credentials).

_Steps:_

1. From agent A, refresh the token so a newer credential lands on disk.
2. From agent B, drive a stale in-memory refresh path; verify it adopts the on-disk credential rather than burning.

_Expected:_ Stale in-memory credential is replaced by the newer on-disk one; no burn is recorded.

_Evidence to capture:_

- Before/after credential file mtimes (redacted); gateway log excerpt.

_Safety declaration:_

- stagingOnly: true
- mutatesData: true
- changesAuth: true
- invokesPaidApi: false
- writesWorkspaceFiles: false
- expectedMutations: `credential rotation via documented UI/tooling path`
- cleanupRollback: `confirm both agents share a valid credential; no burn`
- evidenceCapture: `mtime deltas`, `log excerpt`

────────────────────────────────────────────────────────────────────────

#### `auth.acp-log-identity-manual` — ACP log events carry authenticated identity; no bypass via log fields

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `auth`
- Matrix IDs: `UM-08a`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A staging ACP session emitting log events and access to the receiving side.

_Steps:_

1. Emit a log event with a plausibly forged identity field.
2. Confirm the receiving side ignores forged identity and uses the authenticated session identity.

_Expected:_ Log identity is authenticated; forged fields are ignored.

_Evidence to capture:_

- Log event capture and receiver-side identity resolution.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- changesAuth: false
- invokesPaidApi: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `read-only`
- evidenceCapture: `event capture`, `identity resolution`

────────────────────────────────────────────────────────────────────────

#### `runtime-infra.macos-dep-rationale-manual` — macOS resolution / provider metadata rationale documented

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `runtime-infra`, `providers`
- Matrix IDs: `UM-27a`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Access to the maintainer release docs or the local runtime preservation doc.

_Steps:_

1. Locate the rationale for the current macOS resolution/lockfile choices.
2. Confirm the rationale is documented and cross-referenced from OPENCLAW_UPGRADE_PLAN_V2.md.

_Expected:_ The rationale is discoverable in the maintainer docs / runtime-preservation doc.

_Evidence to capture:_

- Excerpt from the referenced doc.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `observational only`
- evidenceCapture: `doc excerpt`

────────────────────────────────────────────────────────────────────────

#### `providers.generated-bundle-manual` — Provider generated bundles are not carried onto the upgrade target

- Status: **manual** · kind: `behavior` · duration: 0ms
- Groups: `providers`
- Matrix IDs: `UM-17a`, `UM-27b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- A clean v2026.7.1 worktree.
- Access to the current runtime provider catalog.

_Steps:_

1. In the stable worktree, run the standard provider catalog generator (pnpm run providers:generate or the documented equivalent).
2. Diff the freshly generated catalog against the current 2026.4.2 runtime catalog.
3. For each model missing from the fresh catalog, decide whether it is: (a) intentionally retired, or (b) still required — in which case add a source patch and regenerate.

_Expected:_ The upgraded runtime uses regenerated provider catalogs; no hand-edited generated bundles remain.

_Evidence to capture:_

- Diff output for the two catalogs and the decision log for each divergence.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `read-only diff`
- evidenceCapture: `diff output`, `decision log`

────────────────────────────────────────────────────────────────────────

#### `providers.zap-baseline-manual` — ZAP security scan baselines preserved as evidence, not runtime carry-over

- Status: **manual** · kind: `evidence` · duration: 0ms
- Groups: `providers`
- Matrix IDs: `UM-17b`
- Notes: Manual contract. Requires operator-attached evidence before the gate can pass.

**Manual contract**

_Prerequisites:_

- Access to the ZAP baseline artifacts stored alongside the fork checkpoint.

_Steps:_

1. Locate the ZAP baseline artifacts.
2. Confirm they are archived (not layered into the runtime image).
3. Cross-reference the artifact manifest with the current threat model doc.

_Expected:_ Baselines are archived; not shipped in the runtime image.

_Evidence to capture:_

- Archive location + artifact manifest.

_Safety declaration:_

- stagingOnly: true
- mutatesData: false
- writesWorkspaceFiles: false
- expectedMutations: none
- cleanupRollback: `read-only`
- evidenceCapture: `archive path`, `manifest`

────────────────────────────────────────────────────────────────────────

### EVIDENCE PASS (immutable artifact) (1)

#### `memory-firewall.current-runtime-evidence` — Immutable canary checkpoint proves 13 assertions and zero residual rows (CURRENT baseline only)

- Status: **pass** · kind: `evidence` · duration: 7ms
- Groups: `memory-firewall`
- Matrix IDs: `MEM-01`
- Notes: Evidence class only. Authoritative for the CURRENT baseline; the target baseline requires a fresh evidence artifact.

Evidence:

- checkpoint dir: `<redacted-path:...<redacted:entropy>>`
- manifest files verified: `7`
- assertions: `13`
- projects: `["openclaw","r2c","main"]`
- residual rows: `0`

────────────────────────────────────────────────────────────────────────

### BEHAVIOR PASS (runtime invariant) (7)

#### `memory-firewall.isolated-suite-behavior` — Focused memory Vitest suite proves <redacted:entropy> isolation on a disposable LanceDB

- Status: **pass** · kind: `behavior` · duration: 19854ms
- Groups: `memory-firewall`
- Matrix IDs: `MEM-01`, `UM-06a`
- Notes: Focused memory suite passed 28/28 tests across 3 files.

Evidence:

- exit code: `0`
- timed out: `false`
- wall duration ms: `19853`
- test files: `3/3 passed`
- tests: `28/28 passed`
- vitest duration ms: `19030`

────────────────────────────────────────────────────────────────────────

#### `memory-firewall.effective-plugin-config` — Effective plugin config: project slot enabled, stock lancedb not active

- Status: **pass** · kind: `behavior` · duration: 0ms
- Groups: `memory-firewall`, `memory-schema`
- Matrix IDs: `MEM-01`
- Notes: Effective config binds memory slot to the project extension; no stock memory-lancedb entry is active.

Evidence:

- plugins.slots.memory: `memory-lancedb-project`
- plugins.entries.memory-lancedb-project.enabled: `true`
- plugins.entries.memory-lancedb present: `false`
- plugins.entries.memory-lancedb enabled: `false`
- plugins.load.paths: `<redacted:cycle>`

────────────────────────────────────────────────────────────────────────

#### `memory-schema.session-mapping-behavior` — conversations.db sessions table exposes the columns project resolution needs

- Status: **pass** · kind: `behavior` · duration: 3ms
- Groups: `memory-schema`
- Matrix IDs: `MEM-01`

Evidence:

- sessions columns: `["id","session_key","project_id","agent_id","title","channel","hidden","active_root_index","created_at","updated_at","tree_hash"]`
- projects columns: `["id","name","description","icon","color","created_at","updated_at"]`

────────────────────────────────────────────────────────────────────────

#### `mounts-permissions.exact-audit` — Exact per-row mount audit (<redacted:entropy>)

- Status: **pass** · kind: `behavior` · duration: 8ms
- Groups: `mounts-permissions`
- Matrix IDs: `MOUNT-01`, `MOUNT-02`, `MOUNT-03`
- Notes: Every enabled row is exact per registry; reconciled shape matches 32+1+2.

Evidence:

- audit.summary: `{"registryRows":35,"enabledRows":33,"disabledRows":2,"readyRows":33,"activeFuseMounts":32,"aliases":1,"failedEnabledRows":0,"uniqueHostPaths":33,"duplicateHostPathGroups":2,"enabledMountConflicts":0,"nestedHostPathGroups":1,"staleDirectories":0,"extraFuseMounts":0}`
- staleDirectories: `[]`
- extraFuseMounts: `[]`
- duplicateHostPathGroups: `2`
- enabledMountConflicts: `0`

────────────────────────────────────────────────────────────────────────

#### `mounts-permissions.git-trust-readonly` — Git ownership trust is honored across every mounted repo root

- Status: **pass** · kind: `behavior` · duration: 155ms
- Groups: `mounts-permissions`
- Matrix IDs: `MOUNT-04`
- Notes: git rev-parse passed with optional locks disabled across 18 mounted repos.

Evidence:

- 4corner-resources--4cornerresources: `trusted`
- blue-bird-nest-lines--bb-nest: `trusted`
- <redacted:entropy>: `trusted`
- kirkwood--kirkwood: `trusted`
- mighty-tour--mightytour: `trusted`
- openclaw--claude-code-source: `trusted`
- openclaw--openclaw: `trusted`
- openclaw--openclaw-ui: `trusted`
- opensupply--opensupply: `trusted`
- opensupply--theoptumgroup: `trusted`
- r2c--compare-colleges: `trusted`
- r2c--r2c-student-loan-calculator: `trusted`
- r2c--r2c-student-loan-calculator-iframe: `trusted`
- r2c--r2capp-v3: `trusted`
- r2c--road2college: `trusted`
- <redacted:entropy>: `trusted`
- sunrail--sunrailv3: `trusted`
- theory-time--lms-migration-tool: `trusted`

────────────────────────────────────────────────────────────────────────

#### `history-recovery.paginated-behavior` — chat.history.full paginates correctly and matches the full-history checksum

- Status: **pass** · kind: `behavior` · duration: 34409ms
- Groups: `history-recovery`
- Matrix IDs: `UM-08b`
- Notes: Confirmed offset/hasMore/total continuity across 2 partitionings; aggregated checksum equals the full-history checksum. Used 6/8 RPC slots.

Evidence:

- sessionKey sha256: `3bfa370e0ab706cfb3e761475b0ca93c679eaeba43fb134dfe3062c078047a21`
- total messages: `40`
- distinct partitionings: `2`
- limit=14 pages: `3`
- limit=20 pages: `2`
- aggregate checksum sha256: `36537aa90e4018aa654ab7c9703aa4ddb8a60032332ebdbf70b047408d92a3c8`
- budget calls used: `6`
- budget max: `8`
- min messages required: `8`
- hard page limit: `2000`
- candidates attempted: `1`
- elapsed ms: `34409`

────────────────────────────────────────────────────────────────────────

#### `ui-checkpoint.focused-behavior` — Focused UI Vitest suite proves fallback ordering, toolCallId correlation, and run-lifecycle cleanup (4 files, >=52 tests)

- Status: **pass** · kind: `behavior` · duration: 1585ms
- Groups: `fallback-persistence`, `model-provenance`, `streaming-cleanup`
- Matrix IDs: `UI-01`, `UI-02b`, `UI-03a`, `UI-03b`
- Notes: Focused UI checkpoint suite passed 52/52 tests across 4 files.

Evidence:

- exit code: `0`
- timed out: `false`
- wall duration ms: `1581`
- test files: `4/4 passed`
- tests: `52/52 passed`
- vitest duration ms: `822`

────────────────────────────────────────────────────────────────────────

### INVENTORY PASS (source/file only — NOT behavior) (33)

#### `memory-firewall.project-plugin-installed` — memory-lancedb-project extension is installed and no duplicate lancedb ext discovered

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `memory-firewall`
- Matrix IDs: `MEM-01`, `RT-01`

Evidence:

- plugin id: `memory-lancedb-project`
- kind: `memory`
- duplicate stock extension present: `false`

────────────────────────────────────────────────────────────────────────

#### `memory-firewall.source-fail-closed-inventory` — extension source contains fail-closed session mapping and exact projectId filters

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `memory-firewall`
- Matrix IDs: `MEM-01`
- Notes: Source inventory OK — this is not proof of runtime behavior; see memory-firewall.current-runtime-evidence and memory-firewall.isolated-suite-behavior.

Evidence:

- resolveProjectId returns null on missing sessionKey: `true`
- returns null on empty short session key: `true`
- opens conversations.db read-only: `true`
- filters by projectId in search: `true`
- delete predicate scoped by projectId: `true`
- fail-closed scope resolution (agentId && projectId): `true`

────────────────────────────────────────────────────────────────────────

#### `memory-schema.projectId-required-inventory` — memory table schema requires projectId column

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `memory-schema`
- Matrix IDs: `MEM-01`

Evidence:

- schema-guard present: `true`
- projectId declared: `true`

────────────────────────────────────────────────────────────────────────

#### `mounts-permissions.ipv4-inventory` — openclaw-mount.sh forces IPv4 for SSHFS (source inventory)

- Status: **pass** · kind: `inventory` · duration: 2ms
- Groups: `mounts-permissions`
- Matrix IDs: `CP-01`

Evidence:

- path: `<redacted-path:.../openclaw--openclaw/openclaw-mount.sh>`
- IPv4 override present: `true`

────────────────────────────────────────────────────────────────────────

#### `mounts-permissions.helper-baked-inventory` — Dockerfile bakes the reconciled mount helpers

- Status: **pass** · kind: `inventory` · duration: 3ms
- Groups: `mounts-permissions`, `runtime-infra`
- Matrix IDs: `UM-20`, `MOUNT-03`

Evidence:

- Dockerfile.custom mentions mount helper: `true`
- Dockerfile.mountfix mentions mount helper: `true`

────────────────────────────────────────────────────────────────────────

#### `mounts-permissions.helper-layered-inventory` — Dockerfile.mountfix layers helper + restore + status

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `mounts-permissions`, `runtime-infra`
- Matrix IDs: `MOUNT-03`

Evidence:

- openclaw-mount.sh: `true`
- openclaw-mount-restore: `true`
- mount-registry-status.mjs: `true`

────────────────────────────────────────────────────────────────────────

#### `history-recovery.session-context-recovery-installed` — session-context-recovery extension is installed

- Status: **pass** · kind: `inventory` · duration: 0ms
- Groups: `history-recovery`
- Matrix IDs: `RT-02`

Evidence:

- extension root: `<redacted-path:.../extensions/session-context-recovery>`

────────────────────────────────────────────────────────────────────────

#### `history-recovery.tree-recovery-inventory` — conversation-tree recovery utility is present in the UI checkpoint

- Status: **pass** · kind: `inventory` · duration: 2ms
- Groups: `history-recovery`
- Matrix IDs: `UM-08b`

Evidence:

- tree-like utils: `["conversationDbApi.ts","conversationTree.ts"]`

────────────────────────────────────────────────────────────────────────

#### `transcript-archive.installed` — transcript-archive extension is installed

- Status: **pass** · kind: `inventory` · duration: 0ms
- Groups: `transcript-archive`
- Matrix IDs: `RT-03`

Evidence:

- extension root: `<redacted-path:.../extensions/transcript-archive>`

────────────────────────────────────────────────────────────────────────

#### `streaming-cleanup.heartbeat-inventory` — UI useGatewayEvents separates liveness from progress and does not reset progress on generic heartbeat

- Status: **pass** · kind: `inventory` · duration: 4ms
- Groups: `streaming-cleanup`
- Matrix IDs: `UI-03b`
- Notes: Inventory only — see streaming-cleanup manual contracts for behavior.

Evidence:

- mentions heartbeat: `true`
- explicitly ignores heartbeat for progress: `true`
- separates writing/idle/between phase timeouts: `true`
- does NOT reset run timer on heartbeat: `true`

────────────────────────────────────────────────────────────────────────

#### `acp.preset-catalog-inventory` — ACP preset catalog module exists and declares supported routing symbols

- Status: **pass** · kind: `inventory` · duration: 3ms
- Groups: `acp`
- Matrix IDs: `UM-02`
- Notes: Direct Opus 4.8/5 selectors come from the gateway model catalog. This ACP inventory intentionally does not require unverified Claude Code ACP presets.

Evidence:

- path: `<redacted-path:.../acp/presets.ts>`
- declares AcpModelPreset: `true`
- exports ACP_MODEL_PRESETS: `true`
- declares acpxModel routing: `true`
- contains supported Opus 4.6 preset: `true`
- does NOT contain invalid claude-opus-5-0: `true`

────────────────────────────────────────────────────────────────────────

#### `acp.context-preamble-inventory` — ACP context preamble file exists at ~/.openclaw/acp-context-preamble.md

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `acp`
- Matrix IDs: `RT-08`

Evidence:

- path: `<redacted-path:.../.openclaw/acp-context-preamble.md>`
- sizeBytes: `10041`

────────────────────────────────────────────────────────────────────────

#### `mcp-bridge.forge-installed` — Patched Forge MCP server is present

- Status: **pass** · kind: `inventory` · duration: 0ms
- Groups: `mcp-bridge`
- Matrix IDs: `RT-04`

Evidence:

- path: `<redacted-path:.../mcp/forge-mcp-server-patched>`

────────────────────────────────────────────────────────────────────────

#### `mcp-bridge.zoom-installed` — Zoom MCP server is present

- Status: **pass** · kind: `inventory` · duration: 0ms
- Groups: `mcp-bridge`
- Matrix IDs: `RT-05`

Evidence:

- path: `<redacted-path:.../mcp/zoom-mcp-server>`

────────────────────────────────────────────────────────────────────────

#### `mcp-bridge.lando-inventory` — lando-mcp-server exists in core repo

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `mcp-bridge`
- Matrix IDs: `UM-16a`

Evidence:

- path: `<redacted-path:.../mcp-servers/lando-mcp-server>`

────────────────────────────────────────────────────────────────────────

#### `attachments.mime-allowlist-inventory` — input-files MIME allowlist includes text/calendar and JSONL variants; no blanket text/\* bypass

- Status: **pass** · kind: `inventory` · duration: 2ms
- Groups: `attachments`
- Matrix IDs: `UM-12`, `CP-03`

Evidence:

- text/calendar: `true`
- application/jsonl: `true`
- application/x-ndjson: `true`

────────────────────────────────────────────────────────────────────────

#### `model-provenance.opus-5-canonical-inventory` — No source file exposes claude-opus-5-0 as a selectable option

- Status: **pass** · kind: `inventory` · duration: 3ms
- Groups: `model-provenance`
- Matrix IDs: `MODEL-03`

Evidence:

- <redacted-path:.../acp/presets.ts>: `absent`
- <redacted-path:.../constants/acpPresets.ts>: `absent`

────────────────────────────────────────────────────────────────────────

#### `model-provenance.opus-4-8-inventory` — Direct Opus 4.8 model is allowed and declared by the effective gateway catalog

- Status: **pass** · kind: `inventory` · duration: 0ms
- Groups: `model-provenance`
- Matrix IDs: `MODEL-02`
- Notes: This validates the direct Anthropic model used by shared gateway-catalog selectors. Claude Code ACP presets remain separate and must not advertise unsupported model IDs.

Evidence:

- anthropic/claude-opus-4-8 allowed: `true`
- claude-opus-4-8 provider model declared: `true`

────────────────────────────────────────────────────────────────────────

#### `fallback-persistence.dnd-inventory` — UI ModelMultiSelect has drag/drop and keyboard-accessible reorder controls

- Status: **pass** · kind: `inventory` · duration: 2ms
- Groups: `fallback-persistence`
- Matrix IDs: `UI-01`

Evidence:

- onDragStart: `true`
- onDrop and dataTransfer: `true`
- move-up button: `true`
- move-down button: `true`
- button handlers call reorder: `true`

────────────────────────────────────────────────────────────────────────

#### `project-files.server-inventory` — UI split-API server exposes project manifest routes

- Status: **pass** · kind: `inventory` · duration: 0ms
- Groups: `project-files`
- Matrix IDs: `PF-01`

Evidence:

- path: `<redacted-path:.../server/projectManifest.js>`

────────────────────────────────────────────────────────────────────────

#### `browser-isolation.ports-inventory` — Per-project browser port registry is present and non-empty with unique ports

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `browser-isolation`
- Matrix IDs: `RT-06`

Evidence:

- profileCount: `25`
- uniquePortCount: `25`

────────────────────────────────────────────────────────────────────────

#### `runtime-infra.dockerfile-inventory` — Custom Dockerfile is present

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `runtime-infra`
- Matrix IDs: `UM-13a`

Evidence:

- path: `<redacted-path:.../openclaw--openclaw/Dockerfile.custom>`

────────────────────────────────────────────────────────────────────────

#### `runtime-infra.build-config-inventory` — tsdown config and package.json build script inventory

- Status: **pass** · kind: `inventory` · duration: 2ms
- Groups: `runtime-infra`
- Matrix IDs: `UM-13b`

Evidence:

- tsdown config or script: `<redacted-path:.../openclaw--openclaw/tsdown.config.ts>`
- package.json build script: `true`
- package.json name: `openclaw`

────────────────────────────────────────────────────────────────────────

#### `runtime-infra.tooling-inventory` — Operational tooling set (patch/mount/reauth/routing/CA/upgrade scripts)

- Status: **pass** · kind: `inventory` · duration: 4ms
- Groups: `runtime-infra`
- Matrix IDs: `UM-15`

Evidence:

- required:patch-gateway-bundles.sh: `true`
- required:openclaw-mount.sh: `true`
- optional:openclaw-mount-restore.sh: `false`
- optional:mount-registry-status.mjs: `true`
- optional:reauth.sh: `false`
- optional:route.sh: `false`
- optional:ca-update.sh: `false`

────────────────────────────────────────────────────────────────────────

#### `runtime-infra.stale-bundle-inventory` — Bundle patch script removes stale mount directories

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `runtime-infra`
- Matrix IDs: `CP-02`

Evidence:

- path: `<redacted-path:...<redacted:entropy>.sh>`

────────────────────────────────────────────────────────────────────────

#### `runtime-infra.gitignore-inventory` — .gitignore OR .git/info/exclude excludes local bundle/workspace artifacts

- Status: **pass** · kind: `inventory` · duration: 3ms
- Groups: `runtime-infra`
- Matrix IDs: `UM-19`

Evidence:

- pattern:/gateway-cli/: `true`
- pattern:/input-files/: `true`
- pattern:/workspace/: `true`
- pattern:/patch(?:es|-bundles)?/: `true`

────────────────────────────────────────────────────────────────────────

#### `docs.upgrade-artifacts-inventory` — AGENTS.md is present in core repo

- Status: **pass** · kind: `inventory` · duration: 0ms
- Groups: `docs`
- Matrix IDs: `UM-14a`

Evidence:

- path: `<redacted-path:.../openclaw--openclaw/AGENTS.md>`

────────────────────────────────────────────────────────────────────────

#### `docs.pr-maintainer-skill-inventory` — PR maintainer skill file present

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `docs`
- Matrix IDs: `UM-14b`

Evidence:

- path: `<redacted-path:.../openclaw-pr-maintainer/SKILL.md>`

────────────────────────────────────────────────────────────────────────

#### `docs.upgrade-patches-inventory` — Upgrade patches inventory doc present

- Status: **pass** · kind: `inventory` · duration: 0ms
- Groups: `docs`
- Matrix IDs: `UM-14c`

Evidence:

- path: `<redacted-path:.../plugins/architecture.md>`

────────────────────────────────────────────────────────────────────────

#### `docs.local-runtime-inventory` — docs/local-runtime-preservation.md is present

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `docs`
- Matrix IDs: `CP-04`

Evidence:

- path: `<redacted-path:.../docs/local-runtime-preservation.md>`

────────────────────────────────────────────────────────────────────────

#### `docs.checkpoint-validation-inventory` — docs/pre-upgrade-checkpoint-validation.md is present

- Status: **pass** · kind: `inventory` · duration: 0ms
- Groups: `docs`
- Matrix IDs: `CP-05`

Evidence:

- path: `<redacted-path:.../docs/pre-upgrade-checkpoint-validation.md>`

────────────────────────────────────────────────────────────────────────

#### `docs.memory-firewall-inventory` — Memory-firewall deployment recorded

- Status: **pass** · kind: `inventory` · duration: 0ms
- Groups: `docs`
- Matrix IDs: `MEM-02`

Evidence:

- path: `<redacted-path:.../docs/local-runtime-preservation.md>`

────────────────────────────────────────────────────────────────────────

#### `docs.mount-baseline-inventory` — Mount baseline reconciliation recorded

- Status: **pass** · kind: `inventory` · duration: 1ms
- Groups: `docs`
- Matrix IDs: `MOUNT-02`, `MOUNT-05`

Evidence:

- path: `<redacted-path:.../audits/MOUNT_BASELINE_RECONCILIATION.md>`

────────────────────────────────────────────────────────────────────────
