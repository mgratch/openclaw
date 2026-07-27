import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditMountRegistry, parseProcMounts } from "./mount-registry-status.mjs";

function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mount-registry-"));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("audits mounted, aliased, and deliberately disabled registry rows", () =>
  withTempDir((mountBase) => {
    const canonical = path.join(mountBase, "project-a--shared");
    const alias = path.join(mountBase, "project-b--shared");
    fs.mkdirSync(canonical);
    fs.symlinkSync(canonical, alias, "dir");
    const registry = {
      "project-a--shared": { hostPath: "/host/shared", access: "ro" },
      "project-b--shared": {
        hostPath: "/host/shared",
        access: "ro",
        kind: "alias",
        canonicalMount: "project-a--shared",
      },
      "project-c--offline": {
        hostPath: "/host/offline",
        access: "rw",
        enabled: false,
        status: "offline",
      },
    };
    const procMounts = parseProcMounts(
      `user@host:/host/shared ${canonical} fuse.sshfs ro,nosuid,nodev 0 0\n`,
      mountBase,
    );
    const report = auditMountRegistry({ registry, procMounts, mountBase });
    assert.equal(report.ok, true);
    assert.deepEqual(report.summary, {
      registryRows: 3,
      enabledRows: 2,
      disabledRows: 1,
      readyRows: 2,
      activeFuseMounts: 1,
      aliases: 1,
      failedEnabledRows: 0,
      uniqueHostPaths: 2,
      duplicateHostPathGroups: 1,
      enabledMountConflicts: 0,
      nestedHostPathGroups: 0,
      staleDirectories: 0,
      extraFuseMounts: 0,
    });
  }));

test("rejects duplicate enabled regular mounts and stale directories", () =>
  withTempDir((mountBase) => {
    fs.mkdirSync(path.join(mountBase, "stale"));
    const registry = {
      one: { hostPath: "/host/shared", access: "ro" },
      two: { hostPath: "/host/shared", access: "ro" },
    };
    const report = auditMountRegistry({ registry, procMounts: new Map(), mountBase });
    assert.equal(report.ok, false);
    assert.equal(report.summary.enabledMountConflicts, 1);
    assert.deepEqual(report.staleDirectories, ["stale"]);
  }));

test("reports source and access mismatches as failed enabled rows", () =>
  withTempDir((mountBase) => {
    const target = path.join(mountBase, "project--repo");
    fs.mkdirSync(target);
    const registry = { "project--repo": { hostPath: "/host/repo", access: "ro" } };
    const procMounts = parseProcMounts(
      `user@host:/host/other ${target} fuse.sshfs rw,nosuid,nodev 0 0\n`,
      mountBase,
    );
    const report = auditMountRegistry({ registry, procMounts, mountBase });
    assert.equal(report.ok, false);
    assert.equal(report.summary.failedEnabledRows, 1);
    assert.equal(report.mounts[0].state, "source-mismatch");
  }));

test("restore mounts canonicals before aliases and skips disabled rows", () =>
  withTempDir((dir) => {
    const mountBase = path.join(dir, "mounts");
    const bin = path.join(dir, "bin");
    fs.mkdirSync(mountBase);
    fs.mkdirSync(bin);
    const registryPath = path.join(dir, "registry.json");
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        "project-b--shared": {
          hostPath: "/host/shared",
          access: "ro",
          kind: "alias",
          canonicalMount: "project-a--shared",
        },
        "project-c--offline": {
          hostPath: "/host/offline",
          access: "rw",
          enabled: false,
          reason: "offline",
        },
        "project-a--shared": { hostPath: "/host/shared", access: "ro" },
      }),
    );
    const mountCommand = path.join(bin, "openclaw-mount");
    fs.writeFileSync(
      mountCommand,
      `#!/bin/sh\nmkdir -p "${mountBase}/$3/.git"\nprintf '{"ok":true,"mount_point":"%s"}\\n' "${mountBase}/$3"\n`,
      { mode: 0o755 },
    );
    const mountpointCommand = path.join(bin, "mountpoint");
    fs.writeFileSync(mountpointCommand, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const gitSafeMarker = path.join(dir, "git-safe.txt");
    const gitCommand = path.join(bin, "git");
    fs.writeFileSync(
      gitCommand,
      `#!/bin/sh\nif [ "$3" = "--add" ]; then printf '%s\\n' "$5" >> "${gitSafeMarker}"; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    const result = spawnSync("python3", [path.resolve("scripts/openclaw-mount-restore")], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        OPENCLAW_MOUNT_REGISTRY: registryPath,
        OPENCLAW_MOUNT_BASE: mountBase,
        OPENCLAW_MOUNT_COMMAND: mountCommand,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /ALIAS project-b--shared/);
    assert.match(result.stdout, /DISABLED project-c--offline/);
    assert.match(result.stdout, /GIT SAFE/);
    assert.equal(fs.lstatSync(path.join(mountBase, "project-b--shared")).isSymbolicLink(), true);
    assert.equal(
      fs.readFileSync(gitSafeMarker, "utf8").trim(),
      path.join(mountBase, "project-a--shared"),
    );
  }));

test("restore fails preflight before mounting duplicate enabled sources", () =>
  withTempDir((dir) => {
    const registryPath = path.join(dir, "registry.json");
    const marker = path.join(dir, "called");
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        one: { hostPath: "/host/shared", access: "ro" },
        two: { hostPath: "/host/shared", access: "ro" },
      }),
    );
    const command = path.join(dir, "mount-command");
    fs.writeFileSync(command, `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    const result = spawnSync("python3", [path.resolve("scripts/openclaw-mount-restore")], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_MOUNT_REGISTRY: registryPath,
        OPENCLAW_MOUNT_BASE: path.join(dir, "mounts"),
        OPENCLAW_MOUNT_COMMAND: command,
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /PREFLIGHT FAIL/);
    assert.equal(fs.existsSync(marker), false);
  }));
