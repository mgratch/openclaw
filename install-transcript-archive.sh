#!/bin/bash
# install-transcript-archive.sh
# Run this from your OpenClaw project directory (where docker-compose.yml lives)
#
# This script installs the transcript-archive plugin into your running
# OpenClaw 2026.2.18 instance.

set -euo pipefail

OPENCLAW_DIR="$HOME/.openclaw"
HOOKS_DIR="$OPENCLAW_DIR/hooks"
PLUGIN_DIR="$HOOKS_DIR/transcript-archive"
ARCHIVE_DIR="$OPENCLAW_DIR/workspace/archives"
CONFIG_FILE="$OPENCLAW_DIR/openclaw.json"

echo "=== OpenClaw Transcript Archive Plugin Installer ==="
echo ""

# Step 1: Verify OpenClaw is running
echo "Step 1: Checking OpenClaw status..."
if docker compose ps 2>/dev/null | grep -qi "gateway.*running\|gateway.*up\|gateway.*started"; then
  echo "✅ Gateway is running"
elif docker compose ps 2>/dev/null | grep -qi "gateway"; then
  echo "⚠️  Gateway container exists but may not be running. Continuing anyway..."
else
  echo "⚠️  Could not confirm gateway status. Continuing with install..."
fi
echo ""

# Step 2: Verify hooks are enabled
echo "Step 2: Checking hooks configuration..."
if ! grep -q '"hooks"' "$CONFIG_FILE" 2>/dev/null; then
  echo "❌ No hooks section in config. Add hooks.enabled: true"
  exit 1
fi
echo "✅ Hooks section exists in config"
echo ""

# Step 3: Create plugin directory
echo "Step 3: Creating plugin directory..."
mkdir -p "$PLUGIN_DIR"
echo "✅ Created $PLUGIN_DIR"
echo ""

# Step 4: Create archive output directory
echo "Step 4: Creating archive output directory..."
mkdir -p "$ARCHIVE_DIR"
echo "✅ Created $ARCHIVE_DIR"
echo ""

# Step 5: Write the plugin files
echo "Step 5: Writing plugin files..."

# --- index.ts ---
cat > "$PLUGIN_DIR/index.ts" << 'PLUGIN_EOF'
/**
 * OpenClaw Transcript Archive Plugin
 *
 * Captures complete conversation transcripts via plugin hooks, preserving
 * data that would otherwise be lost to compaction, truncation, or gateway
 * storage failures.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Types — we define locally to avoid import issues outside the monorepo
type PluginApi = {
  id: string;
  name: string;
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void; debug?: (msg: string) => void };
  on: (hookName: string, handler: (event: any, ctx: any) => any, opts?: { priority?: number }) => void;
  registerCli: (registrar: (ctx: any) => void, opts?: { commands?: string[] }) => void;
  registerService: (service: { id: string; start: () => void; stop?: () => void }) => void;
  resolvePath: (input: string) => string;
};

// ============================================================================
// Config
// ============================================================================

type PluginConfig = {
  archiveDir?: string;
  snapshotOnCompaction?: boolean;
  snapshotOnReset?: boolean;
  captureToolResults?: boolean;
  captureLlmTraffic?: boolean;
  toolResultSplitThreshold?: number;
};

const DEFAULT_ARCHIVE_DIR = path.join(os.homedir(), ".openclaw", "workspace", "archives");

// ============================================================================
// Helpers
// ============================================================================

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_\-:.]/g, "_").slice(0, 200);
}

function now(): string {
  return new Date().toISOString();
}

function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

type ArchiveEntry = {
  ts: string;
  hook: string;
  sessionKey?: string;
  agentId?: string;
  sessionId?: string;
  data: unknown;
  ctx?: unknown;
};

function appendEntry(archiveDir: string, sessionKey: string | undefined, hook: string, data: unknown, ctx?: unknown): void {
  try {
    const key = sanitizeKey(sessionKey || "_unknown");
    const dir = path.join(archiveDir, key);
    ensureDirSync(dir);
    const filePath = path.join(dir, "transcript.jsonl");

    const entry: ArchiveEntry = {
      ts: now(),
      hook,
      sessionKey,
      data,
      ctx,
    };

    // Extract IDs from context
    if (ctx && typeof ctx === "object") {
      const c = ctx as Record<string, unknown>;
      if (c.agentId) entry.agentId = c.agentId as string;
      if (c.sessionId) entry.sessionId = c.sessionId as string;
    }

    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    console.error(`[transcript-archive] write error: ${String(err)}`);
  }
}

async function snapshotFile(sourceFile: string, archiveDir: string, sessionKey: string | undefined, label: string): Promise<string | null> {
  try {
    const key = sanitizeKey(sessionKey || "_unknown");
    const dir = path.join(archiveDir, key);
    await ensureDir(dir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destFile = path.join(dir, `snapshot-${label}-${timestamp}.jsonl`);
    await fsp.copyFile(sourceFile, destFile);
    return destFile;
  } catch (err) {
    console.error(`[transcript-archive] snapshot failed: ${String(err)}`);
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ============================================================================
// Plugin
// ============================================================================

const plugin = {
  id: "transcript-archive",
  name: "Transcript Archive",
  description: "Complete conversation archival via hooks — preserves full transcripts, untruncated tool results, and LLM traffic.",
  version: "0.1.0",

  async register(api: PluginApi) {
    const cfg = (api.pluginConfig ?? {}) as PluginConfig;
    const archiveDir = cfg.archiveDir || DEFAULT_ARCHIVE_DIR;
    const captureToolResults = cfg.captureToolResults !== false;
    const captureLlmTraffic = cfg.captureLlmTraffic !== false;
    const snapshotOnCompaction = cfg.snapshotOnCompaction !== false;
    const snapshotOnReset = cfg.snapshotOnReset !== false;
    const toolResultSplitThreshold = cfg.toolResultSplitThreshold ?? 100 * 1024;

    await ensureDir(archiveDir);
    api.logger.info(`transcript-archive: archiving to ${archiveDir.replace(os.homedir(), "~")}`);

    // Helper to get sessionKey from various context shapes
    const sk = (ctx: any): string | undefined =>
      ctx?.sessionKey || ctx?.conversationId || undefined;

    // ====================================================================
    // Gateway Lifecycle
    // ====================================================================

    api.on("gateway_start", (event: any, ctx: any) => {
      appendEntry(archiveDir, undefined, "gateway_start", event, ctx);
      api.logger.info(`transcript-archive: gateway started on port ${event.port}`);
    });

    // ====================================================================
    // Session Lifecycle
    // ====================================================================

    api.on("session_start", async (event: any, ctx: any) => {
      const sessionKey = ctx.agentId ? `${ctx.agentId}:${ctx.sessionId}` : ctx.sessionId;
      const dir = path.join(archiveDir, sanitizeKey(sessionKey || "_unknown"));
      await ensureDir(dir);
      if (captureToolResults) {
        await ensureDir(path.join(dir, "tool-results"));
      }
      appendEntry(archiveDir, sessionKey, "session_start", event, ctx);
    });

    api.on("session_end", (event: any, ctx: any) => {
      const sessionKey = ctx.agentId ? `${ctx.agentId}:${ctx.sessionId}` : ctx.sessionId;
      appendEntry(archiveDir, sessionKey, "session_end", event, ctx);
    });

    // ====================================================================
    // Message Lifecycle
    // ====================================================================

    api.on("message_received", (event: any, ctx: any) => {
      appendEntry(archiveDir, sk(ctx), "message_received", event, ctx);
    });

    api.on("message_sent", (event: any, ctx: any) => {
      appendEntry(archiveDir, sk(ctx), "message_sent", event, ctx);
    });

    // ====================================================================
    // Agent Lifecycle
    // ====================================================================

    api.on("before_prompt_build", (event: any, ctx: any) => {
      appendEntry(archiveDir, sk(ctx), "before_prompt_build", {
        prompt: event.prompt,
        messageCount: event.messages?.length ?? 0,
      }, ctx);
    });

    if (captureLlmTraffic) {
      api.on("llm_input", (event: any, ctx: any) => {
        appendEntry(archiveDir, sk(ctx), "llm_input", {
          runId: event.runId,
          provider: event.provider,
          model: event.model,
          prompt: event.prompt,
          systemPromptLength: event.systemPrompt?.length ?? 0,
          historyMessageCount: event.historyMessages?.length ?? 0,
          imagesCount: event.imagesCount,
        }, ctx);
      });

      api.on("llm_output", (event: any, ctx: any) => {
        appendEntry(archiveDir, sk(ctx), "llm_output", {
          runId: event.runId,
          provider: event.provider,
          model: event.model,
          assistantTextLengths: event.assistantTexts?.map((t: string) => t.length) ?? [],
          assistantTexts: event.assistantTexts,
          usage: event.usage,
        }, ctx);
      });
    }

    api.on("agent_end", (event: any, ctx: any) => {
      appendEntry(archiveDir, sk(ctx), "agent_end", {
        success: event.success,
        error: event.error,
        durationMs: event.durationMs,
        messageCount: event.messages?.length ?? 0,
      }, ctx);
    });

    // ====================================================================
    // Tool Execution
    // ====================================================================

    if (captureToolResults) {
      api.on("before_tool_call", (event: any, ctx: any) => {
        appendEntry(archiveDir, sk(ctx), "before_tool_call", event, ctx);
      });

      api.on("after_tool_call", async (event: any, ctx: any) => {
        const resultStr = JSON.stringify(event.result ?? "");

        if (resultStr.length > toolResultSplitThreshold) {
          // Write large result to separate file
          const key = sanitizeKey(sk(ctx) || "_unknown");
          const toolDir = path.join(archiveDir, key, "tool-results");
          await ensureDir(toolDir);
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const safeName = (event.toolName || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
          const fileName = `${timestamp}-${safeName}.json`;
          const filePath = path.join(toolDir, fileName);
          await fsp.writeFile(filePath, JSON.stringify(event.result, null, 2), "utf-8");

          appendEntry(archiveDir, sk(ctx), "after_tool_call", {
            toolName: event.toolName,
            params: event.params,
            durationMs: event.durationMs,
            error: event.error,
            resultSize: resultStr.length,
            resultFile: filePath,
          }, ctx);
        } else {
          appendEntry(archiveDir, sk(ctx), "after_tool_call", event, ctx);
        }
      });

      // tool_result_persist is SYNCHRONOUS — no async!
      api.on("tool_result_persist", (event: any, ctx: any) => {
        const sessionKey = ctx.sessionKey;
        try {
          const key = sanitizeKey(sessionKey || "_unknown");
          const dir = path.join(archiveDir, key);
          ensureDirSync(dir);
          const filePath = path.join(dir, "transcript.jsonl");
          const entry: ArchiveEntry = {
            ts: now(),
            hook: "tool_result_persist",
            sessionKey,
            agentId: ctx.agentId,
            data: {
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              isSynthetic: event.isSynthetic,
              message: event.message,
            },
            ctx: { agentId: ctx.agentId, sessionKey: ctx.sessionKey },
          };
          fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
        } catch (err) {
          console.error(`[transcript-archive] tool_result_persist write error: ${String(err)}`);
        }
        // Return nothing — don't modify the message
      });
    }

    // ====================================================================
    // Compaction & Reset
    // ====================================================================

    api.on("before_compaction", async (event: any, ctx: any) => {
      appendEntry(archiveDir, sk(ctx), "before_compaction", {
        messageCount: event.messageCount,
        compactingCount: event.compactingCount,
        tokenCount: event.tokenCount,
        sessionFile: event.sessionFile,
      }, ctx);

      // Snapshot if file path available
      if (snapshotOnCompaction && event.sessionFile) {
        const snap = await snapshotFile(event.sessionFile, archiveDir, sk(ctx), "pre-compaction");
        if (snap) {
          api.logger.info(`transcript-archive: pre-compaction snapshot saved (${event.messageCount} msgs)`);
        }
      }
    });

    api.on("after_compaction", (event: any, ctx: any) => {
      appendEntry(archiveDir, sk(ctx), "after_compaction", {
        messageCount: event.messageCount,
        compactedCount: event.compactedCount,
        tokenCount: event.tokenCount,
        sessionFile: event.sessionFile,
      }, ctx);
    });

    api.on("before_reset", async (event: any, ctx: any) => {
      appendEntry(archiveDir, sk(ctx), "before_reset", {
        reason: event.reason,
        sessionFile: event.sessionFile,
        messageCount: event.messages?.length ?? 0,
      }, ctx);

      if (snapshotOnReset && event.sessionFile) {
        const snap = await snapshotFile(event.sessionFile, archiveDir, sk(ctx), "pre-reset");
        if (snap) {
          api.logger.info(`transcript-archive: pre-reset snapshot saved`);
        }
      }
    });

    // ====================================================================
    // CLI Commands
    // ====================================================================

    api.registerCli(({ program }: any) => {
      const archive = program.command("archive").description("Transcript archive commands");

      archive.command("list").description("List archived sessions").action(async () => {
        try {
          const entries = await fsp.readdir(archiveDir, { withFileTypes: true });
          const sessions = entries.filter((e: any) => e.isDirectory());
          if (sessions.length === 0) {
            console.log("No archived sessions found.");
            return;
          }
          console.log(`Found ${sessions.length} archived sessions:\n`);
          for (const session of sessions.sort((a: any, b: any) => a.name.localeCompare(b.name))) {
            const tp = path.join(archiveDir, session.name, "transcript.jsonl");
            let lines = 0;
            let size = "0 B";
            try {
              const stat = await fsp.stat(tp);
              size = formatBytes(stat.size);
              const content = await fsp.readFile(tp, "utf-8");
              lines = content.trim().split("\n").length;
            } catch { /* no transcript */ }
            console.log(`  ${session.name}  (${lines} entries, ${size})`);
          }
        } catch (err) {
          console.error(`Error: ${String(err)}`);
        }
      });

      archive.command("stats").description("Show archive stats").argument("[session]", "Session key").action(async (sessionKey?: string) => {
        if (sessionKey) {
          const dir = path.join(archiveDir, sanitizeKey(sessionKey));
          const tp = path.join(dir, "transcript.jsonl");
          try {
            const content = await fsp.readFile(tp, "utf-8");
            const lines = content.trim().split("\n");
            const entries = lines.map((l: string) => JSON.parse(l));
            const hookCounts: Record<string, number> = {};
            for (const entry of entries) {
              hookCounts[entry.hook] = (hookCounts[entry.hook] ?? 0) + 1;
            }
            console.log(`Session: ${sessionKey}`);
            console.log(`Entries: ${entries.length}`);
            console.log(`First: ${entries[0]?.ts ?? "N/A"}`);
            console.log(`Last: ${entries[entries.length - 1]?.ts ?? "N/A"}`);
            console.log(`\nHooks:`);
            for (const [hook, count] of Object.entries(hookCounts).sort((a, b) => (b[1] as number) - (a[1] as number))) {
              console.log(`  ${hook}: ${count}`);
            }
          } catch (err) {
            console.error(`Error: ${String(err)}`);
          }
        } else {
          try {
            const entries = await fsp.readdir(archiveDir, { withFileTypes: true });
            const sessions = entries.filter((e: any) => e.isDirectory());
            let total = 0;
            let totalSize = 0;
            for (const s of sessions) {
              try {
                const stat = await fsp.stat(path.join(archiveDir, s.name, "transcript.jsonl"));
                totalSize += stat.size;
                const c = await fsp.readFile(path.join(archiveDir, s.name, "transcript.jsonl"), "utf-8");
                total += c.trim().split("\n").length;
              } catch { /* skip */ }
            }
            console.log(`Archive: ${archiveDir.replace(os.homedir(), "~")}`);
            console.log(`Sessions: ${sessions.length}`);
            console.log(`Entries: ${total}`);
            console.log(`Size: ${formatBytes(totalSize)}`);
          } catch (err) {
            console.error(`Error: ${String(err)}`);
          }
        }
      });
    }, { commands: ["archive"] });

    // ====================================================================
    // Service
    // ====================================================================

    api.registerService({
      id: "transcript-archive",
      start: () => {
        api.logger.info(`transcript-archive: service started`);
      },
      stop: () => {
        api.logger.info(`transcript-archive: service stopped`);
      },
    });
  },
};

export default plugin;
PLUGIN_EOF

echo "✅ Wrote index.ts"

# --- package.json ---
cat > "$PLUGIN_DIR/package.json" << 'PKG_EOF'
{
  "name": "openclaw-hook-transcript-archive",
  "version": "0.1.0",
  "description": "Complete conversation archival plugin for OpenClaw",
  "main": "index.ts",
  "type": "module",
  "openclaw": {
    "hooks": [
      "gateway_start",
      "session_start",
      "session_end",
      "message_received",
      "message_sent",
      "before_prompt_build",
      "llm_input",
      "llm_output",
      "agent_end",
      "before_tool_call",
      "after_tool_call",
      "tool_result_persist",
      "before_compaction",
      "after_compaction",
      "before_reset"
    ]
  }
}
PKG_EOF

echo "✅ Wrote package.json"

# --- HOOK.md (metadata for OpenClaw hook discovery) ---
cat > "$PLUGIN_DIR/HOOK.md" << 'HOOK_EOF'
---
name: transcript-archive
description: "Complete conversation archival — preserves full transcripts, untruncated tool results, and LLM traffic"
metadata:
  {
    "openclaw":
      {
        "emoji": "📜",
        "events": ["gateway_start", "session_start", "session_end", "message_received", "message_sent", "before_prompt_build", "llm_input", "llm_output", "agent_end", "before_tool_call", "after_tool_call", "tool_result_persist", "before_compaction", "after_compaction", "before_reset"],
        "install": [{ "id": "custom", "kind": "path", "label": "Custom workspace hook" }],
      },
  }
---

# Transcript Archive

Complete conversation archival via plugin hooks. Preserves full transcripts,
untruncated tool results, and LLM traffic that would otherwise be lost to
compaction or gateway storage failures.

Archives are stored as append-only JSONL files per session key at
`~/.openclaw/workspace/archives/`.

## Configuration

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "transcript-archive": {
          "enabled": true
        }
      }
    }
  }
}
```
HOOK_EOF

echo "✅ Wrote HOOK.md"
echo ""

# Step 6: Update config to enable the plugin
echo "Step 6: Checking config for transcript-archive entry..."

if grep -q "transcript-archive" "$CONFIG_FILE" 2>/dev/null; then
  echo "✅ transcript-archive already in config"
else
  echo "⚠️  Need to add transcript-archive to your config."
  echo ""
  echo "Add this to your openclaw.json under hooks.internal.entries:"
  echo ""
  echo '  "transcript-archive": {'
  echo '    "enabled": true'
  echo '  }'
  echo ""
  echo "Your hooks.internal section should look like:"
  echo ""
  echo '  "hooks": {'
  echo '    "internal": {'
  echo '      "enabled": true,'
  echo '      "entries": {'
  echo '        "session-memory": { "enabled": true },'
  echo '        "transcript-archive": { "enabled": true }'
  echo '      }'
  echo '    }'
  echo '  }'
  echo ""
fi

# Step 7: Verify files
echo "Step 7: Verifying installation..."
echo ""
echo "Plugin files:"
ls -la "$PLUGIN_DIR/"
echo ""
echo "Archive directory:"
ls -la "$ARCHIVE_DIR/" 2>/dev/null || echo "  (empty — will populate on first conversation)"
echo ""

# Step 8: Restart instructions
echo "=== Installation Complete ==="
echo ""
echo "Next steps:"
echo ""
echo "1. Edit ~/.openclaw/openclaw.json to enable the plugin (see above)"
echo ""
echo "2. Restart the gateway:"
echo "   docker compose restart openclaw-gateway"
echo ""
echo "3. Verify it loaded:"
echo "   docker compose logs openclaw-gateway 2>&1 | grep transcript-archive"
echo ""
echo "4. Have a conversation, then check:"
echo "   ls ~/.openclaw/workspace/archives/"
echo "   cat ~/.openclaw/workspace/archives/*/transcript.jsonl | head -5 | python3 -m json.tool"
echo ""
echo "5. If it doesn't load, check if OpenClaw sees it:"
echo "   docker compose exec openclaw-gateway node dist/index.js hooks list"
echo "   docker compose exec openclaw-gateway node dist/index.js plugins list 2>&1 | grep transcript"
