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

## Mount baseline and unresolved discrepancy

At checkpoint time:

```text
registry entries: 35
openclaw-mount helper reports active: 35
kernel-visible FUSE mounts: 32
```

Duplicate host-path mappings remain:

```text
/Users/marcgratch/.ssh
  desert-river-solutions--.ssh (ro)
  lidar--.ssh (ro)

/Users/marcgratch/tools/security-scanner-lando
  desert-river-solutions--security-scanner-lando (rw)
  lidar--security-scanner-lando (ro)
```

Do not normalize or replay the registry blindly. Before upgrade cutover, reconcile helper state with `/proc/mounts`, preserve intentional project sharing, and verify every logical mount's effective access mode.

## Recovery scripts excluded from openclaw-ui Git

Eight May 2026 DB/import/merge scripts were archived under:

```text
/home/node/.openclaw/upgrade-checkpoints/20260727-044211/excluded-from-git/ui/scripts
```

They contain state-specific destructive recovery logic and hard-coded historical assumptions. They are forensic artifacts, not normal application source.

## Excluded generated dependencies

`openclaw-ui/node_modules.linux-binaries.bak/` is intentionally excluded from Git. The dependency lockfile and package manager are the reproducible source; a file manifest exists in the checkpoint for forensic reference.
