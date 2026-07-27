// Deterministic integration test for the mount exact audit using in-memory
// fixtures. Uses a nonexistent mountBase so the audit's stale-directory
// listing returns [] and does not depend on the host filesystem.

import assert from "node:assert/strict";
import test from "node:test";
import { auditMountRegistry, parseProcMounts } from "../../mount-registry-status.mjs";

const MOUNT_BASE = "/tmp/upgrade-contracts-nonexistent-mountbase-fixture";

const registry = {
  alpha: { hostPath: "/srv/a", access: "ro", enabled: true, kind: "mount" },
  beta: { hostPath: "/srv/b", access: "rw", enabled: true, kind: "mount" },
  "alpha-alias": {
    hostPath: "/srv/a",
    access: "ro",
    enabled: true,
    kind: "alias",
    canonicalMount: "alpha",
  },
  gamma: { hostPath: "/srv/g", access: "ro", enabled: false, kind: "mount" },
};

function aliasFs() {
  return {
    lstatSync: () => ({ isSymbolicLink: () => true }),
    realpathSync: () => `${MOUNT_BASE}/alpha`,
  };
}

test("audit reports mounted rows and ok=true for a clean baseline", () => {
  const proc =
    [
      `user@host:/srv/a ${MOUNT_BASE}/alpha fuse.sshfs ro,other 0 0`,
      `user@host:/srv/b ${MOUNT_BASE}/beta fuse.sshfs rw,other 0 0`,
    ].join("\n") + "\n";
  const parsed = parseProcMounts(proc, MOUNT_BASE);
  const audit = auditMountRegistry({
    registry,
    procMounts: parsed,
    mountBase: MOUNT_BASE,
    filesystem: aliasFs(),
  });
  assert.equal(audit.summary.registryRows, 4);
  assert.equal(audit.summary.enabledRows, 3);
  assert.equal(audit.summary.disabledRows, 1);
  assert.equal(audit.summary.aliases, 1);
  assert.equal(audit.summary.activeFuseMounts, 2);
  assert.equal(
    audit.ok,
    true,
    `audit not ok: extraMounts=${JSON.stringify(audit.extraFuseMounts)} stale=${JSON.stringify(audit.staleDirectories)} failed=${audit.summary.failedEnabledRows}`,
  );
});

test("audit fails on source mismatch", () => {
  const proc =
    [
      `user@host:/srv/WRONG ${MOUNT_BASE}/alpha fuse.sshfs ro,other 0 0`,
      `user@host:/srv/b ${MOUNT_BASE}/beta fuse.sshfs rw,other 0 0`,
    ].join("\n") + "\n";
  const parsed = parseProcMounts(proc, MOUNT_BASE);
  const audit = auditMountRegistry({
    registry,
    procMounts: parsed,
    mountBase: MOUNT_BASE,
    filesystem: aliasFs(),
  });
  assert.equal(audit.ok, false);
  const alpha = audit.mounts.find((m) => m.name === "alpha");
  assert.equal(alpha.state, "source-mismatch");
});

test("audit fails on access mismatch", () => {
  const proc =
    [
      `user@host:/srv/a ${MOUNT_BASE}/alpha fuse.sshfs rw,other 0 0`,
      `user@host:/srv/b ${MOUNT_BASE}/beta fuse.sshfs rw,other 0 0`,
    ].join("\n") + "\n";
  const parsed = parseProcMounts(proc, MOUNT_BASE);
  const audit = auditMountRegistry({
    registry,
    procMounts: parsed,
    mountBase: MOUNT_BASE,
    filesystem: aliasFs(),
  });
  assert.equal(audit.ok, false);
  const alpha = audit.mounts.find((m) => m.name === "alpha");
  assert.equal(alpha.state, "access-mismatch");
});

test("audit flags extra fuse mounts as failures", () => {
  const proc =
    [
      `user@host:/srv/a ${MOUNT_BASE}/alpha fuse.sshfs ro,other 0 0`,
      `user@host:/srv/b ${MOUNT_BASE}/beta fuse.sshfs rw,other 0 0`,
      `user@host:/srv/rogue ${MOUNT_BASE}/rogue fuse.sshfs rw,other 0 0`,
    ].join("\n") + "\n";
  const parsed = parseProcMounts(proc, MOUNT_BASE);
  const audit = auditMountRegistry({
    registry,
    procMounts: parsed,
    mountBase: MOUNT_BASE,
    filesystem: aliasFs(),
  });
  assert.equal(audit.extraFuseMounts.length, 1);
  assert.equal(audit.ok, false);
});
