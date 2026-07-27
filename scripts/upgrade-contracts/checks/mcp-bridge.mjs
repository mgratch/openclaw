// MCP bridge / Forge / Zoom / Lando checks.

import { existsSync } from "node:fs";
import path from "node:path";
import { HOME, REPO_ROOT } from "../lib/env.mjs";
import { defineCheck } from "../lib/runner.mjs";

defineCheck({
  id: "mcp-bridge.forge-installed",
  name: "Patched Forge MCP server is present",
  groups: ["mcp-bridge"],
  matrixIds: ["RT-04"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const p = path.join(HOME, "mcp", "forge-mcp-server-patched");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    return { status: "pass", evidence: [{ label: "path", value: p }] };
  },
});

defineCheck({
  id: "mcp-bridge.zoom-installed",
  name: "Zoom MCP server is present",
  groups: ["mcp-bridge"],
  matrixIds: ["RT-05"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const p = path.join(HOME, "mcp", "zoom-mcp-server");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    return { status: "pass", evidence: [{ label: "path", value: p }] };
  },
});

defineCheck({
  id: "mcp-bridge.lando-inventory",
  name: "lando-mcp-server exists in core repo",
  groups: ["mcp-bridge"],
  matrixIds: ["UM-16a"],
  kind: "inventory",
  automated: "auto",
  async run() {
    const p = path.join(REPO_ROOT, "mcp-servers", "lando-mcp-server");
    if (!existsSync(p)) {
      return { status: "fail", notes: `Missing ${p}` };
    }
    return { status: "pass", evidence: [{ label: "path", value: p }] };
  },
});

defineCheck({
  id: "mcp-bridge.gateway-bridge-manual",
  name: "Gateway-bridge MCP exposes OpenClaw tools inside ACP",
  groups: ["mcp-bridge"],
  matrixIds: ["UM-09", "UM-25"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["A staging ACP session with the gateway-bridge MCP enabled."],
    steps: [
      "List tools inside the ACP session.",
      "Invoke one OpenClaw tool (e.g. memory_recall) through the bridge.",
      "Trigger a name-collision path by installing a same-named tool on both sides; verify sanitization.",
    ],
    expected:
      "OpenClaw tools appear inside the ACP tool list; collisions are sanitized without swallowing calls.",
    evidence: ["Full tool list; bridged tool response; sanitizer log excerpt."],
    safety: {
      stagingOnly: true,
      mutatesData: true,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: ["one bridged tool call"],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["tool list", "response", "log excerpt"],
    },
  },
});

defineCheck({
  id: "mcp-bridge.forge-live-manual",
  name: "Forge MCP responds and redacts environment retrieval",
  groups: ["mcp-bridge"],
  matrixIds: ["RT-04"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Staging Forge MCP configured and reachable.",
      "A Forge action that reads environment values.",
    ],
    steps: [
      "Invoke the environment-reading action against staging.",
      "Inspect the response for any raw secret leakage.",
    ],
    expected: "Response returns redacted values; no plaintext token leaves the container.",
    evidence: ["Redacted response body and Forge server log excerpt."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["read-only"],
      evidenceCapture: ["response", "log excerpt"],
    },
  },
});

defineCheck({
  id: "mcp-bridge.zoom-live-manual",
  name: "Zoom MCP tool set responds via configured OAuth",
  groups: ["mcp-bridge"],
  matrixIds: ["RT-05"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Staging Zoom MCP configured with valid OAuth."],
    steps: [
      "Invoke a read-only Zoom action (e.g. list meetings).",
      "Verify the response is authenticated and correctly scoped.",
    ],
    expected: "The read-only Zoom call succeeds without a re-auth prompt.",
    evidence: ["Truncated Zoom API response (redacted)."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: true,
      changesAuth: false,
      downloadsExternal: false,
      writesWorkspaceFiles: false,
      externalMessaging: false,
      expectedMutations: [],
      cleanupRollback: ["read-only"],
      evidenceCapture: ["response"],
    },
  },
});

defineCheck({
  id: "mcp-bridge.lando-live-manual",
  name: "Lando MCP performs a safe read-only action",
  groups: ["mcp-bridge"],
  matrixIds: ["UM-16a"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "Staging Lando MCP configured with a project the operator is allowed to inspect.",
    ],
    steps: [
      "Invoke lando list / status (never a destructive one).",
      "Verify no lifecycle command runs without explicit confirmation.",
    ],
    expected: "Read-only calls succeed; destructive ops still require explicit confirmation.",
    evidence: ["Redacted MCP response body."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["read-only"],
      evidenceCapture: ["response"],
    },
  },
});

defineCheck({
  id: "mcp-bridge.lando-safety-manual",
  name: "Lando MCP enforces safe quoting, containment, timeouts, and destructive-confirmation",
  groups: ["mcp-bridge"],
  matrixIds: ["UM-16b"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: ["Staging Lando MCP and a project whose lifecycle can be exercised safely."],
    steps: [
      "Attempt a command with shell-metacharacters in an argument; confirm quoting rejects it.",
      "Attempt a slow-running command past the configured timeout; confirm timeout enforced.",
      "Attempt a destructive op; confirm explicit confirmation is required.",
    ],
    expected:
      "Every safety invariant is honored; nothing destructive proceeds without confirmation.",
    evidence: ["Command outputs; timeout log; confirmation prompt capture."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["outputs", "log", "prompt capture"],
    },
  },
});

defineCheck({
  id: "mcp-bridge.sanitizer-manual",
  name: "MCP tool-name sanitizer prevents collisions",
  groups: ["mcp-bridge"],
  matrixIds: ["UM-25"],
  kind: "behavior",
  automated: "manual",
  manual: {
    prerequisites: [
      "A staging MCP server registering a tool with the same name as an OpenClaw built-in.",
    ],
    steps: [
      "Register the colliding tool.",
      "List tools; verify the collision was renamed.",
      "Invoke both tools; verify they route to the correct handler.",
    ],
    expected: "Sanitizer renames the colliding tool and preserves both handlers.",
    evidence: ["Tool list showing renamed entry and both responses."],
    safety: {
      stagingOnly: true,
      mutatesData: false,
      invokesPaidApi: false,
      writesWorkspaceFiles: false,
      expectedMutations: [],
      cleanupRollback: ["staging-only"],
      evidenceCapture: ["tool list", "responses"],
    },
  },
});
