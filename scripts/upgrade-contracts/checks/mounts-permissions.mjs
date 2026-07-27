// Mount and permission checks.
//
// The reconciled baseline (32 physical FUSE + 1 safe alias + 2 explicitly
// disabled rows, zero enabled failures) is the acceptance state. We use
// scripts/mount-registry-status.mjs auditMountRegistry so the check tracks the
// same source of truth as ops tooling.
//
// Exact per-row audit precedes the summary 32+1+2 assertion. Aggregate counts
// alone are insufficient — a mount could be "active" but source-mismatched.
// The audit exposes exact source, target, access, alias target, enabled/kind,
// stale directories, conflicts, extras — every one is checked.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { parseProcMounts, auditMountRegistry } from "../../mount-registry-status.mjs";
import { REPO_ROOT, MOUNT_BASE, MOUNT_REGISTRY, PROC_MOUNTS } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

// -- Behavior: exact per-row audit -----------------------------------------

defineCheck({
  id: "mounts-permissions.exact-audit",
  name: "Exact per-row mount audit (source/target/access/alias/enabled/stale/conflicts/extras)",
  groups: ["mounts-permissions"],
  matrixIds: ["MOUNT-01", "MOUNT-02", "MOUNT-03"],
  kind: "behavior",
  requires: ["mount-registry"],
  automated: "auto",
  async run() {
    if (!existsSync(MOUNT_REGISTRY)) {
      return { status: "fail", notes: `mount registry missing at ${MOUNT_REGISTRY}` };
    }
    const registry = JSON.parse(await fs.readFile(MOUNT_REGISTRY, "utf8"));
    let procMountsText;
    try {
      procMountsText = await fs.readFile(PROC_MOUNTS, "utf8");
    } catch (err) {
      return { status: "fail", notes: `cannot read ${PROC_MOUNTS}: ${err?.message ?? err}` };
    }
    const procMounts = parseProcMounts(procMountsText, MOUNT_BASE);
    const audit = auditMountRegistry({ registry, procMounts, mountBase: MOUNT_BASE });

    const failures = [];
    for (const row of audit.mounts) {
      if (!row.enabled) {
        continue;
      }
      if (row.kind === "alias") {
        if (row.state !== "alias" || !row.active) {
          failures.push(`alias ${row.name} state=${row.state}`);
        }
      } else {
        if (row.state !== "mounted" || !row.active) {
          failures.push(`${row.name} state=${row.state}`);
        }
      }
    }
    if (audit.staleDirectories.length > 0) {
      failures.push(`stale directories: ${audit.staleDirectories.join(", ")}`);
    }
    if (audit.extraFuseMounts.length > 0) {
      failures.push(`extra fuse mounts: ${audit.extraFuseMounts.join(", ")}`);
    }
    if (audit.enabledMountConflicts.length > 0) {
      failures.push(
        `enabled mount conflicts: ${audit.enabledMountConflicts.map((c) => c.hostPath).join(", ")}`,
      );
    }

    const s = audit.summary;
    // Only after the exact audit passes do we assert the reconciled shape.
    const shape = {
      registryRows: 35,
      enabledRows: 33,
      disabledRows: 2,
      aliases: 1,
      activeFuseMounts: 32,
    };
    const mismatches = [];
    for (const [k, v] of Object.entries(shape)) {
      if (s[k] !== v) {
        mismatches.push(`${k}: want ${v}, got ${s[k]}`);
      }
    }

    const evidence = [
      { label: "audit.summary", value: s },
      { label: "staleDirectories", value: audit.staleDirectories },
      { label: "extraFuseMounts", value: audit.extraFuseMounts },
      { label: "duplicateHostPathGroups", value: audit.duplicateHostPaths.length },
      { label: "enabledMountConflicts", value: audit.enabledMountConflicts.length },
    ];

    if (!audit.ok) {
      return { status: "fail", evidence, notes: `Mount audit failed: ${failures.join("; ")}` };
    }
    if (mismatches.length > 0) {
      return {
        status: "fail",
        evidence,
        notes: `Reconciled shape mismatch: ${mismatches.join("; ")}`,
      };
    }
    return {
      status: "pass",
      evidence,
      notes: "Every enabled row is exact per registry; reconciled shape matches 32+1+2.",
    };
  },
});

// -- Inventory: openclaw-mount.sh forces IPv4 ------------------------------

defineCheck({
  id: "mounts-permissions.ipv4-inventory",
  name: "openclaw-mount.sh forces IPv4 for SSHFS (source inventory)",
  groups: ["mounts-permissions"],
  matrixIds: ["CP-01"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const scriptPath = path.join(REPO_ROOT, "openclaw-mount.sh");
    if (!existsSync(scriptPath)) {
      return { status: "fail", notes: `Missing ${scriptPath}` };
    }
    const src = await fs.readFile(scriptPath, "utf8");
    const hasIpv4 = /SSH_COMMAND=/.test(src) && /ssh\s+-4/.test(src);
    if (!hasIpv4) {
      return {
        status: "fail",
        notes: "openclaw-mount.sh no longer contains the IPv4 SSH_COMMAND override",
      };
    }
    return {
      status: "pass",
      evidence: [
        { label: "path", value: scriptPath },
        { label: "IPv4 override present", value: true },
      ],
    };
  },
});

// -- Inventory: Dockerfile bakes mount helper ------------------------------

defineCheck({
  id: "mounts-permissions.helper-baked-inventory",
  name: "Dockerfile bakes the reconciled mount helpers",
  groups: ["mounts-permissions", "runtime-infra"],
  matrixIds: ["UM-20", "MOUNT-03"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const candidates = ["Dockerfile.custom", "Dockerfile.mountfix"];
    const evidence = [];
    let baked = false;
    for (const name of candidates) {
      const p = path.join(REPO_ROOT, name);
      if (!existsSync(p)) {
        continue;
      }
      const src = await fs.readFile(p, "utf8");
      const mentionsHelper = /openclaw-mount\b/.test(src) || /openclaw-mount-restore\b/.test(src);
      evidence.push({ label: `${name} mentions mount helper`, value: mentionsHelper });
      if (mentionsHelper) {
        baked = true;
      }
    }
    if (!baked) {
      return { status: "fail", evidence, notes: "No Dockerfile mentions the mount helper" };
    }
    return { status: "pass", evidence };
  },
});

// -- Inventory: helper layered ---------------------------------------------

defineCheck({
  id: "mounts-permissions.helper-layered-inventory",
  name: "Dockerfile.mountfix layers helper + restore + status",
  groups: ["mounts-permissions", "runtime-infra"],
  matrixIds: ["MOUNT-03"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const p = path.join(REPO_ROOT, "Dockerfile.mountfix");
    if (!existsSync(p)) {
      return { status: "fail", notes: "Dockerfile.mountfix missing" };
    }
    const src = await fs.readFile(p, "utf8");
    const evidence = [
      { label: "openclaw-mount.sh", value: /openclaw-mount\.sh/.test(src) },
      { label: "openclaw-mount-restore", value: /openclaw-mount-restore/.test(src) },
      { label: "mount-registry-status.mjs", value: /mount-registry-status\.mjs/.test(src) },
    ];
    const missing = evidence.filter((e) => !e.value).map((e) => e.label);
    if (missing.length > 0) {
      return { status: "fail", evidence, notes: `Missing layered helpers: ${missing.join(", ")}` };
    }
    return { status: "pass", evidence };
  },
});

// -- Behavior: Git trust across every mounted repo root --------------------

defineCheck({
  id: "mounts-permissions.git-trust-readonly",
  name: "Git trust is honored across every mounted repo root (RO probe)",
  groups: ["mounts-permissions"],
  matrixIds: ["MOUNT-04"],
  kind: "behavior",
  automated: "auto",
  async run() {
    const evidence = [];
    let ok = true;
    let repos = 0;
    try {
      const entries = await fs.readdir(MOUNT_BASE, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() && !e.isSymbolicLink()) {
          continue;
        }
        const target = path.join(MOUNT_BASE, e.name);
        const gitDir = path.join(target, ".git");
        if (!existsSync(gitDir)) {
          continue;
        }
        repos++;
        // Read HEAD as a stand-in for "git trusts this directory". We do NOT
        // exec `git` because that would require child_process across mounts;
        // instead we open HEAD read-only to confirm the mount is trusted from
        // filesystem semantics. Git's trust check is orthogonal — the manual
        // check must verify `git status` runs cleanly.
        try {
          const head = await fs.readFile(path.join(gitDir, "HEAD"), "utf8");
          evidence.push({ label: e.name, value: head.trim().slice(0, 60) });
        } catch (err) {
          evidence.push({ label: e.name, value: `HEAD unreadable: ${err?.message ?? err}` });
          ok = false;
        }
      }
    } catch (err) {
      return {
        status: "fail",
        notes: `Cannot walk mount base ${MOUNT_BASE}: ${err?.message ?? err}`,
      };
    }
    if (repos === 0) {
      return { status: "fail", notes: "No mounted repos found — expected at least one" };
    }
    if (!ok) {
      return {
        status: "fail",
        evidence,
        notes: "One or more mounted repos has an unreadable .git/HEAD",
      };
    }
    return {
      status: "pass",
      evidence,
      notes: `RO probe OK across ${repos} mounted repos; the git-status semantic remains a manual verification.`,
    };
  },
});

// -- Manual: host mount access enforces RO/RW ------------------------------

defineCheck({
  id: "mounts-permissions.host-mount-access-manual",
  name: "Host-mount access enforces RO/RW per registry (staging RW canary)",
  groups: ["mounts-permissions"],
  matrixIds: ["UM-04a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Live gateway container with reconciled 32-FUSE baseline.",
      "Explicit staging/safe-live opt-in from Marc; the RW canary is a reserved UUID tag and the harness will clean it up.",
    ],
    steps: [
      "For each RO row (openclaw-mount list --ro), attempt to touch /mnt/host-projects/<name>/.canary-<uuid>; capture stderr.",
      "For one RW row explicitly authorized as the RW canary target, touch a canary file and immediately delete it in the same step.",
      "Confirm every RO attempt fails and the single RW attempt succeeds and is cleaned up.",
    ],
    expected:
      "Every RO attempt fails EROFS or equivalent. Exactly one RW target permits the write and the canary is removed. No canary files remain after the test.",
    evidence: [
      "Touch commands, exit codes, and errno messages.",
      "Post-test ls confirming no canary files remain.",
    ],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      writesWorkspaceFiles: true,
      expectedMutations: ["single RW canary file created and immediately deleted"],
      cleanupRollback: [
        "rm the RW canary in the same step",
        "assert file does not exist post-test",
      ],
      evidenceCapture: ["command outputs", "ls confirming cleanup"],
    },
  },
});

// -- Manual: container mount setup preserves everything --------------------

defineCheck({
  id: "mounts-permissions.container-setup-manual",
  name: "Container mount setup preserves ro/rw + reconnect + IPv4",
  groups: ["mounts-permissions", "runtime-infra"],
  matrixIds: ["UM-26"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging image built from Dockerfile.mountfix.",
      "Ability to snapshot /proc/self/mounts before and after start.",
    ],
    steps: [
      "Boot the staging image; wait for openclaw-mount-restore to complete.",
      "Capture /proc/self/mounts and diff it against the reconciled baseline.",
      "Assert every mount uses ssh_command=ssh -4 and reconnect,ServerAliveInterval=15.",
    ],
    expected:
      "All enabled rows mount with correct ro/rw, IPv4 transport, and reconnect. No extra mounts, no failed rows.",
    evidence: ["Diff vs reconciled baseline; openclaw-mount-restore log excerpt."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging-only boot; no cleanup on live"],
      evidenceCapture: ["diff", "log excerpt"],
    },
  },
});

// -- Manual: git trust behavior --------------------------------------------

defineCheck({
  id: "mounts-permissions.git-trust-manual",
  name: "Host Git repositories remain trusted after mount restore (behavior)",
  groups: ["mounts-permissions"],
  matrixIds: ["MOUNT-04"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Fresh gateway boot with reconciled mount baseline.",
      "A host repository mounted via SSHFS.",
    ],
    steps: [
      "From the container, cd into a mounted host repo and run git status.",
      "Confirm no `fatal: detected dubious ownership` message.",
    ],
    expected: "git status runs cleanly; safe.directory entry present.",
    evidence: ["git status output and container HOME/.gitconfig safe.directory entries."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["no mutation; observational only"],
      evidenceCapture: ["git status output", "safe.directory entries"],
    },
  },
});
