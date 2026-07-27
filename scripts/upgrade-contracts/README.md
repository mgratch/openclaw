# upgrade-contracts

Version-independent, external golden-master contract harness for the OpenClaw
`v2026.4.2 → v2026.7.1` upgrade. It exists because the plan
(`OPENCLAW_UPGRADE_PLAN_V2.md`) requires executable parity tests **before** any
port work begins, and because the audits already identified a long list of
behaviors that must survive the upgrade.

The harness is intentionally _black-box_ wherever possible — it inspects the
running runtime and repo/UI-checkpoint source without depending on internal
module paths that upstream may rearrange.

## Modes

The CLI is **strict by default**. There is a dedicated `--report-only` mode
for baseline capture. Filtered/partial runs can NEVER qualify as a full gate.

```bash
# STRICT gate. Exit non-zero on ANY fail/skip/manual/uncovered/nonterminal/
# dangling/unsafe-manual issue. This is the default.
pnpm run upgrade-contracts:gate

# Baseline capture. Exit 0 even with pending manual/skip contracts.
pnpm run upgrade-contracts:report

# Baseline capture that also writes durable audits/UPGRADE_CONTRACTS_BASELINE-*.
pnpm run upgrade-contracts:baseline

# Focused runs — disqualify strict gate but still write a report:
node scripts/upgrade-contracts/run.mjs --report-only --filter memory-firewall

# Harness self-tests:
pnpm run upgrade-contracts:test
```

## Non-negotiable rules

1. **No hidden failures.** Every check terminates in `PASS`, `FAIL`, `SKIP`, or
   `MANUAL`. Only PASS is terminal for the gate. SKIP and MANUAL are
   nonterminal and block the strict gate.
2. **No gateway restart, no gateway config mutation, no external messages.**
3. **No production-data mutation** except reserved-UUID-prefix disposable
   canaries via `lib/canary.mjs`, with guaranteed cleanup, aggregate error
   surfaces, and a caller-provided `verifyCleanup` residual check.
4. **Redaction on the way out.** Every value written to disk is walked by
   `lib/redact.mjs`. Reports are written atomically at `0600`.
5. **Evidence class is explicit.** Every check declares `kind` as one of
   `behavior`, `inventory`, or `evidence`:
   - `behavior` — runtime/behavioral invariant against effective state
   - `inventory` — file/entry/symbol/regex existence check; NEVER counts as
     behavioral proof of that behavior
   - `evidence` — immutable external artifact (e.g. signed canary) that
     attests to behavior at a specific point in time; authoritative only for
     the CURRENT baseline and does NOT satisfy the target gate
6. **Manual contracts are documented, safety-declared, and validated.** Any
   manual contract that mutates data, invokes a paid/provider API, changes
   auth, downloads, or writes workspace files must include a `safety` block
   declaring `stagingOnly`, the hazard flags, `expectedMutations`,
   `cleanupRollback`, and `evidenceCapture`. The harness refuses to register
   unsafe manuals.
7. **Every automated check must reference at least one preservation-matrix
   row, and every row must list every check that claims it.**

## Preservation matrix

`preservation-matrix.json` — schemaVersion `openclaw-preservation-matrix/v2` —
lists every row that must reach a terminal state before Phase 2 begins.
Multi-concern rows are split with suffixes (for example `UM-04a`, `UM-04b`,
`UM-04c`) so a shallow check cannot satisfy a compound intent while preserving
the exact 28 UM commit SHAs.

Row state:

- `assumed` — no automated or manual check yet; must be replaced;
- `test-only` — a golden-master check exists but final Phase-3 disposition is
  not yet chosen;
- `upstream_equivalent_tested`, `ported_tested`, `retired_with_marc_approval`
  — terminal states allowed by the plan.

`ASSUMED`, `PROBABLY UPSTREAM`, `LOOKS OBSOLETE` are **not** valid terminal
states.

## Environment overrides

- `OPENCLAW_STATE_DIR` — override `~/.openclaw`
- `OPENCLAW_CONFIG_PATH` — override the `openclaw.json` path
- `OPENCLAW_UI_ROOT` — override the sibling UI checkpoint root
- `OPENCLAW_WORKSPACE_DB` — override `~/.openclaw/workspace/conversations.db`
- `OPENCLAW_MOUNT_REGISTRY` — override `~/.openclaw/mount-registry.json`
- `OPENCLAW_MOUNT_BASE` — override `/mnt/host-projects`
- `OPENCLAW_PROC_MOUNTS` — override `/proc/self/mounts`
- `OPENCLAW_GATEWAY_URL` — override the `/health` probe URL

## Directory layout

```
scripts/upgrade-contracts/
├── README.md                    (this file)
├── run.mjs                      CLI entrypoint (strict gate default)
├── preservation-matrix.json     preservation matrix (schemaVersion v2)
├── lib/                         runner, matrix, gate, safety, env, canary,
│                                redact, report
├── checks/                      one module per behavior group
├── __tests__/                   deterministic unit tests (node --test)
└── baseline/                    generated reports (gitignored)
```

Baseline outputs land under `scripts/upgrade-contracts/baseline/`:

- `latest.json` / `latest.md` — most recent report-only baseline
- `latest-gate.json` / `latest-gate.md` — most recent strict-gate run
- JSON reports use schemaVersion `openclaw-upgrade-contracts/v2`; Markdown is separated by evidence class
- `report-<runId>.{json,md}` — per-run snapshots

Durable audit copies land at `audits/UPGRADE_CONTRACTS_BASELINE-<date>.{json,md}`
when passing `--durable-json` / `--durable-md`.

## Extending the harness

To add a check:

1. Add a matrix row (or extend an existing row's `checks[]`) in
   `preservation-matrix.json`.
2. Add or extend a file under `checks/`. Import from `../lib/runner.mjs` and
   call `defineCheck({...})`. **You MUST declare `kind`.**
3. If automated, return `{ status: "pass" | "fail", evidence?, notes? }` from
   `run(ctx)`. Any thrown error is captured as `fail`.
4. If manual and any hazard applies, provide a complete `manual.safety` block.
5. Register the module in `checks/index.mjs`.
6. Add a deterministic unit test in `__tests__/` if the check has drift-prone
   logic.

## Safety guardrails

- The harness only reads `openclaw.json`; it never rewrites it.
- Nothing under `checks/` opens a WebSocket, dispatches a real prompt, or
  sends a Slack/Telegram/Discord message.
- Live gateway interaction is limited to a single `/health` probe.
- The redactor is over-cautious — if it looks like a token, path, email,
  phone, or high-entropy blob, it becomes a sentinel.
