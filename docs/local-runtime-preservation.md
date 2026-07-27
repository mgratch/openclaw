# Local Runtime Preservation Checkpoint

This document records OpenClaw runtime dependencies that are required by Marc's deployment but are intentionally not committed to this source repository because they include machine-specific source, generated bundles, credentials, or user data.

Checkpoint date: 2026-07-27

Checkpoint root:

```text
/home/node/.openclaw/upgrade-checkpoints/20260727-044211
```

## Git worktree recovery

The checkpoint contains binary diffs, local commit series, untracked-source archives, status snapshots, and SHA-256 manifests for both:

```text
/mnt/host-projects/openclaw--openclaw
/mnt/host-projects/openclaw--openclaw-ui
```

## Runtime source archive

```text
runtime/runtime-source.tgz
efa54dfc91f4e652186d33ddd18d13452754c7960c2f93dde5e9b5338c1ca678
```

Contains source/configuration, excluding dependency trees, for:

- `memory-lancedb`
- `session-context-recovery`
- `transcript-archive`
- patched Forge MCP server
- Zoom MCP server
- Gmail MCP proxy
- ACP context preamble
- mount server/restore scripts
- browser manager and port/instruction files

## Patched Claude ACP shim

```text
runtime/claude-agent-acp-local.tgz
a2ff086491f4fbf703b5b22f133cc8e4ef14b1f794a4e7293bce44c7c7852134
```

This is an exact rollback/forensics capture, including its vendor tree, because the active custom behavior is patched inside the installed package. It must be replaced by a reproducible source patch during the stable upgrade rather than copied blindly.

## Hash-pinned bundles

```text
runtime/hash-pinned-bundles.tgz
65f4db34689f1f2a19ef1bcffe3e443bf2a1750166caa18b5d54a695c6b76161
```

Contains the currently mounted ignored bundles:

- `gateway-cli-KOwAt-bF.js`
- `input-files-DvIHM2VH.js`

These exist only for rollback and behavior comparison. They must not be mounted into the upgraded runtime. Their required behavior must be ported to source and rebuilt.

## Private configuration archive

```text
runtime/private-config-and-credentials.tgz
a482f5a0f5f4b0b2556c82ffa6a2d058688e49f7395121507136fd1185277ed4
```

Mode: `0600`. Not committed to Git.

Contains the current OpenClaw config, mount registry, SSHFS private key, and Gmail/Zoom credential volumes. A secret-safe structural copy is stored as:

```text
runtime/openclaw.redacted.json
d7c0ae919f2e51ac0889c240a23fb1e14ed411f328f40d255630715782d043ff
```

## Data inventory

```text
runtime/runtime-file-manifest.txt
d3b108016514230c1d36ac61f6fd4c1096e7795febfc327a77f883cb46ed0cdb
```

This is an inventory only. SQLite, LanceDB, session JSONLs, transcripts, archives, and browser profile data require consistent backups immediately before migration/cutover.

## Project-scoped LanceDB firewall deployment

The pre-upgrade memory firewall was repaired on 2026-07-27 from source commit:

```text
dfc90304e87 fix(memory): enforce project-scoped LanceDB isolation
```

The live runtime uses a uniquely named extension so it cannot collide with the bundled `memory-lancedb` plugin:

```text
plugin id: memory-lancedb-project
source: /home/node/.openclaw/extensions/memory-lancedb-project
slot: plugins.slots.memory = memory-lancedb-project
project map: /home/node/.openclaw/workspace/conversations.db
autoRecall: enabled by default
autoCapture: false
```

The old global `memory-lancedb` copy was moved outside the extension discovery root. The bundled stock plugin remains installed but disabled. Final plugin discovery reports zero duplicate-ID warnings, zero load errors, and zero config warnings.

The project-scoped implementation:

- resolves `projectId` from the immutable tool/hook `sessionKey` through the canonical UI conversation database;
- returns no tool and performs no hook action when project identity cannot be resolved;
- filters exact `projectId` in LanceDB before applying the vector result limit;
- scopes duplicate checks and direct/query deletion to the same project;
- does not expose blank, legacy-global, foreign, or `main` rows as implicit shared memory;
- allows agents in the same project to share project memory while isolating one agent used by multiple projects.

Validation completed before enabling automatic recall:

```text
focused mocked + real-LanceDB tests: 24/24 passed
formatter: passed
linter: passed
live runtime canary: 13/13 assertions passed
projects exercised: openclaw, r2c, main
residual canary rows: 0
```

The live canary proved same-text independent storage, cross-project recall denial, no `main` bypass, foreign-ID deletion denial, owner-row preservation, and fail-closed behavior for an unknown session.

Recovery material is stored under:

```text
/home/node/.openclaw/upgrade-checkpoints/memory-firewall-20260727-125533
```

It contains before/after private config copies, the former global extension, a dependency-free archive of the deployed extension source, the production dependency tree, source commit, live-canary result, and verified SHA-256 manifests. Private config copies remain outside Git with mode `0600`.

`openclaw doctor --non-interactive` reports the extension loaded with zero plugin errors. Its separate “No active memory plugin” note refers to the built-in file/session `memorySearch` manager contract; this legacy LanceDB extension provides `memory_recall`, `memory_store`, `memory_forget`, and lifecycle recall hooks instead. The live tool canary verifies that those surfaces are active. Doctor also notes that `before_agent_start` is a supported legacy hook; migrate the hook to `before_prompt_build` when porting this behavior onto the stable upgrade target.

Rollback requires restoring the private config from the recovery directory and moving the archived extension directories back to their prior locations. Do not re-enable the old plugin before restoring its matching config, because its shared mutable request state and unscoped delete path are the vulnerabilities this deployment removes.

## Reconciled mount baseline

The old `35/35 mounts` target conflated registry rows, directories, and physical FUSE mounts. The validated clean-start baseline is:

```text
logical registry rows: 35
enabled logical rows: 33
ready enabled rows: 33
physical fuse.sshfs mounts: 32
safe same-access aliases: 1
explicitly disabled rows: 2
failed enabled rows: 0
stale directories: 0
extra FUSE mounts: 0
```

Special rows are explicit rather than dependent on JSON ordering:

- `lidar--.ssh` is a safe read-only alias to the canonical DRS read-only SSH mount.
- `lidar--security-scanner-lando` is preserved but blocked because DRS requires `rw` while Lidar requires `ro`; enforcing both requires separate mount namespaces or an independent read-only source.
- `lidar--nighthawk-repos` is preserved but offline because its Mac symlink resolves to an unavailable external SSD target.
- the browser manager now uses `openclaw--openclaw` instead of the obsolete duplicate `openclaw-docker` path.

The helper-only runtime image `openclaw:custom-mountfix` layers the audited restore/status/helper files onto the exact prior `openclaw:custom` image. Startup validation produced `32 mounted, 1 alias, 2 disabled, 0 failed`; strict registry status and 7/7 read-only write-denial probes passed. Recovery material is stored at:

```text
/home/node/.openclaw/upgrade-checkpoints/mount-baseline-20260727-144836
```

Do not replace this model with 35 physical mounts during the stable upgrade. Preserve logical aliases and disabled policy records explicitly, or provide stronger per-project mount namespaces.

## Recovery scripts excluded from openclaw-ui Git

Eight May 2026 DB/import/merge scripts were archived under:

```text
/home/node/.openclaw/upgrade-checkpoints/20260727-044211/excluded-from-git/ui/scripts
```

They contain state-specific destructive recovery logic and hard-coded historical assumptions. They are forensic artifacts, not normal application source.

## Excluded generated dependencies

`openclaw-ui/node_modules.linux-binaries.bak/` is intentionally excluded from Git. The dependency lockfile and package manager are the reproducible source; a file manifest exists in the checkpoint for forensic reference.
