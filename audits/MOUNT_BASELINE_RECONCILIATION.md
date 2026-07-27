# Mount Baseline Reconciliation

_Date: 2026-07-27_

## Decision

The old `35/35 mounts` acceptance target conflated logical registry rows, directories, and kernel FUSE mounts. The corrected baseline is:

```text
logical registry rows: 35
enabled logical rows: 33
disabled logical rows: 2
ready enabled rows: 33
physical fuse.sshfs mounts: 32
safe same-access aliases: 1
failed enabled rows: 0
stale unregistered directories: 0
extra unregistered FUSE mounts: 0
```

A successful restart must reproduce this exact state. It must not manufacture 35 physical FUSE mounts.

## Original discrepancy

Before reconciliation:

```text
registry rows: 35
unique exact host paths: 33
active fuse.sshfs mounts: 32
failed enabled rows: 3
duplicate enabled source groups: 2
stale unregistered directories: 1
```

`openclaw-mount list` happened to return 35 directories, but those were not the same 35 records as the registry:

- registry-only missing row: `lidar--nighthawk-repos`
- helper-only stale directory: `openclaw-docker`
- inactive duplicate directories: `lidar--.ssh`, `lidar--security-scanner-lando`

The helper enumerated directories instead of the registry, so its count was not an authoritative health measure.

## Reconciled special rows

### `lidar--.ssh`

Both Lidar and Desert River Solutions require the exact same host `~/.ssh` source read-only. The DRS row remains the canonical physical FUSE mount. The Lidar row is now an explicit logical alias:

```json
{
  "kind": "alias",
  "canonicalMount": "desert-river-solutions--.ssh",
  "access": "ro",
  "enabled": true
}
```

Restore creates a symlink only after verifying that the canonical source, host path, and access mode match exactly. An alias cannot broaden access.

### `lidar--security-scanner-lando`

DRS intentionally requires `rw`; Lidar intentionally requires `ro`. Both agents share one container mount namespace, so a Lidar alias to the DRS path would silently provide write access. The Lidar row remains in the registry but is explicitly disabled with status `blocked` until per-project mount namespaces or an independent read-only source copy exists.

### `lidar--nighthawk-repos`

The former host path is a symlink:

```text
/Users/marcgratch/Sites/nighthawk-repos
→ /Volumes/Samsung Portable SSD T5 Media/Archived Sites/nighthawk-repos
```

SSHFS does not mount that symlink as a directory, and the external target was unavailable during reconciliation. The row preserves both the original `sourceLink` and resolved external-volume path but is explicitly disabled with status `offline`.

### `openclaw-docker`

This was an empty, inactive, unregistered directory left from a historical alias of the OpenClaw checkout. The canonical row is `openclaw--openclaw`. Only the empty container directory was removed; no host data or registry row was deleted.

### Nested `mg-media` source

`mg-media--mg-media-management` is a project-specific mount nested beneath the active `r2c--road2college` host source. Both are `rw`. It remains intentional but is reported as nested underlying data rather than counted as an independent unique source.

## Runtime implementation

Tracked source now provides:

- `scripts/mount-registry-status.mjs`
  - registry-authoritative status;
  - exact source/access comparison;
  - alias and disabled-state reporting;
  - duplicate and nested source groups;
  - stale directory and extra FUSE detection;
  - strict nonzero exit on an invalid enabled baseline.
- `scripts/openclaw-mount-restore`
  - deterministic sorted restore;
  - preflight rejection of duplicate enabled physical sources;
  - regular mounts restored before aliases;
  - safe same-access alias validation;
  - explicit disabled-row reporting;
  - nonzero exit on any failed enabled row.
- `openclaw-mount.sh`
  - registry-aware `list` output;
  - alias-aware `status` and `unmount` behavior;
  - retained duplicate-source collision protection;
  - IPv4-forced SSHFS transport.
- `Dockerfile.custom`
  - bakes the mount helper, restore script, and status implementation into the custom image.
- `docker-compose.override.yml`
  - runs the baked deterministic restore instead of a mutable live-mounted restore script.

## Validation before restart

```text
mount status/restore tests: 5/5 passed
shell syntax: passed
Python compilation: passed
all 32 active physical mounts match registry source and access
read-only write-denial probes: 6/6 passed
restore result: 32 already + 1 alias + 2 disabled + 0 failed
strict status: passed
```

## Recovery

Pre-migration state is archived at:

```text
/home/node/.openclaw/upgrade-checkpoints/mount-baseline-20260727-144836
```

It includes the current and pre-UI-dedup registries, old live restore/remount scripts, the old baked helper, the pre-change kernel mount table, and the pre-change validator report.

## Remaining gate

Rebuild and recreate `openclaw:custom`, then verify the same baseline from a clean container start:

```text
32 physical FUSE mounts
1 safe logical alias
2 explicitly disabled logical rows
0 failed enabled rows
0 stale directories
0 extra FUSE mounts
```
