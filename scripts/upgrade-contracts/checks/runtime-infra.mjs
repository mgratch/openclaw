// Source-level inventory checks for local runtime infrastructure preserved by
// the upgrade-main custom commits and July checkpoint work.
//
// The .gitignore check MUST inspect .gitignore AND .git/info/exclude, and
// fail if NEITHER excludes the required generated files. That was a
// documented false positive — the previous check returned PASS with a note
// even when both were empty.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "runtime-infra.dockerfile-inventory",
  name: "Custom Dockerfile is present",
  groups: ["runtime-infra"],
  matrixIds: ["UM-13a"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const p = path.join(REPO_ROOT, "Dockerfile.custom");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    return { status: "pass", evidence: [{ label: "path", value: p }] };
  },
});

defineCheck({
  id: "runtime-infra.build-config-inventory",
  name: "tsdown config and package.json build script inventory",
  groups: ["runtime-infra"],
  matrixIds: ["UM-13b"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const tsdown = ["tsdown.config.ts", "tsdown.config.mjs", "scripts/tsdown-build.mjs"]
      .map((r) => path.join(REPO_ROOT, r))
      .find((p) => existsSync(p));
    const pkgPath = path.join(REPO_ROOT, "package.json");
    if (!existsSync(pkgPath)) {
      return { status: "fail", notes: "package.json missing" };
    }
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    const evidence = [
      { label: "tsdown config or script", value: tsdown ?? "absent" },
      { label: "package.json build script", value: typeof pkg.scripts?.build === "string" },
      { label: "package.json name", value: pkg.name ?? null },
    ];
    if (!tsdown) {
      return { status: "fail", evidence, notes: "No tsdown config or build script found" };
    }
    if (typeof pkg.scripts?.build !== "string") {
      return { status: "fail", evidence, notes: "package.json has no build script" };
    }
    return { status: "pass", evidence };
  },
});

defineCheck({
  id: "runtime-infra.tooling-inventory",
  name: "Operational tooling set (patch/mount/reauth/routing/CA/upgrade scripts)",
  groups: ["runtime-infra"],
  matrixIds: ["UM-15"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const required = ["patch-gateway-bundles.sh", "openclaw-mount.sh"];
    // These are optional but their presence adds evidence weight.
    const optional = [
      "openclaw-mount-restore.sh",
      "mount-registry-status.mjs",
      "reauth.sh",
      "route.sh",
      "ca-update.sh",
    ];
    const evidence = [];
    const missingRequired = [];
    for (const rel of required) {
      const p = path.join(REPO_ROOT, rel);
      const present = existsSync(p) || existsSync(path.join(REPO_ROOT, "scripts", rel));
      evidence.push({ label: `required:${rel}`, value: present });
      if (!present) {
        missingRequired.push(rel);
      }
    }
    for (const rel of optional) {
      const present =
        existsSync(path.join(REPO_ROOT, rel)) || existsSync(path.join(REPO_ROOT, "scripts", rel));
      evidence.push({ label: `optional:${rel}`, value: present });
    }
    if (missingRequired.length > 0) {
      return {
        status: "fail",
        evidence,
        notes: `Missing required tooling: ${missingRequired.join(", ")}`,
      };
    }
    return { status: "pass", evidence };
  },
});

defineCheck({
  id: "runtime-infra.stale-bundle-inventory",
  name: "Bundle patch script removes stale mount directories",
  groups: ["runtime-infra"],
  matrixIds: ["CP-02"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const p = path.join(REPO_ROOT, "patch-gateway-bundles.sh");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    const src = await fs.readFile(p, "utf8");
    const hasCleanup =
      /Cleaning stale patched bundles/i.test(src) && /(rmdir|rm\s+-f|rm\s+-rf)/.test(src);
    if (!hasCleanup) {
      return {
        status: "fail",
        notes: "patch-gateway-bundles.sh no longer performs stale-directory cleanup",
      };
    }
    return { status: "pass", evidence: [{ label: "path", value: p }] };
  },
});

defineCheck({
  id: "runtime-infra.gitignore-inventory",
  name: ".gitignore OR .git/info/exclude excludes local bundle/workspace artifacts",
  groups: ["runtime-infra"],
  matrixIds: ["UM-19"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const gitignore = path.join(REPO_ROOT, ".gitignore");
    const exclude = path.join(REPO_ROOT, ".git", "info", "exclude");
    const requiredEntries = [/gateway-cli/, /input-files/, /workspace/, /patch(?:es|-bundles)?/];
    const excludeText = existsSync(exclude) ? await fs.readFile(exclude, "utf8") : "";
    const ignoreText = existsSync(gitignore) ? await fs.readFile(gitignore, "utf8") : "";
    const combined = `${ignoreText}\n${excludeText}`;
    const evidence = [];
    const missing = [];
    for (const rx of requiredEntries) {
      const present = rx.test(combined);
      evidence.push({ label: `pattern:${rx}`, value: present });
      if (!present) {
        missing.push(String(rx));
      }
    }
    if (!existsSync(gitignore) && !existsSync(exclude)) {
      return { status: "fail", notes: "Neither .gitignore nor .git/info/exclude exists" };
    }
    if (missing.length > 0) {
      return {
        status: "fail",
        evidence,
        notes: `Neither .gitignore nor .git/info/exclude covers required patterns: ${missing.join(", ")}`,
      };
    }
    return { status: "pass", evidence };
  },
});

defineCheck({
  id: "runtime-infra.macos-dep-rationale-manual",
  name: "macOS resolution / provider metadata rationale documented",
  groups: ["runtime-infra", "providers"],
  matrixIds: ["UM-27a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Access to the maintainer release docs or the local runtime preservation doc."],
    steps: [
      "Locate the rationale for the current macOS resolution/lockfile choices.",
      "Confirm the rationale is documented and cross-referenced from OPENCLAW_UPGRADE_PLAN_V2.md.",
    ],
    expected: "The rationale is discoverable in the maintainer docs / runtime-preservation doc.",
    evidence: ["Excerpt from the referenced doc."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["observational only"],
      evidenceCapture: ["doc excerpt"],
    },
  },
});
