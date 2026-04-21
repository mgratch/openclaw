# OpenClaw v2026.4.2 Upgrade — Post-Rebuild Patch Guide

Upgraded from v2026.3.2 on 2026-04-01. This document tracks which runtime
patches (volume-mounted over built Docker output) still need re-applying
after each Docker image rebuild.

## Source-Level Patches (Already Applied to Repo)

These live in the git working tree on branch `upgrade-main` and are built
into the Docker image automatically. No post-rebuild action needed.

| Patch | Files |
|---|---|
| ConnId broadcast scoping | `src/gateway/server-chat.ts` |
| Mid-run steering (`chat.send` → `steer()`) | `src/gateway/server-methods/chat.ts` |
| `chat.history.full` endpoint | `src/gateway/server-methods/chat.ts`, `src/gateway/protocol/schema/logs-chat.ts`, `src/gateway/protocol/index.ts`, `src/gateway/protocol/schema/protocol-schemas.ts` |
| Memory-LanceDB agent scoping | `extensions/memory-lancedb/index.ts` |

## Runtime Patches (Must Re-Apply After Each Docker Rebuild)

These are applied to the **built JS output** inside the Docker image via
volume mounts in `docker-compose.override.yml`.

### 1. Gateway CLI Bundles (MAX_PAYLOAD_BYTES + Chat History Limit)

**What**: `MAX_PAYLOAD_BYTES` 25MB → 1GB, `DEFAULT_MAX_CHAT_HISTORY_MESSAGES_BYTES` 6MB → 500MB

**How**: Run `./patch-gateway-bundles.sh` from `~/openclaw/`. It auto-discovers
the new bundle filenames, copies them from the container, applies sed patches,
and updates `docker-compose.override.yml`.

**Why still needed**: Upstream PRs #20381 and #20394 were auto-closed. The
constants remain hardcoded at 25MB and 6MB in upstream.

### 2. Input-Files Bundle (Binary File Pass-Through)

**What**: Adds `binaryPassthroughMimes` Set and returns `{ rawBase64, rawMimeType }`
for non-text, non-image files instead of trying to extract them as text.

**File**: `input-files-BT2Wb53r.js` (was `reply-DhtejUNZ.js` in v2026.3.2 — reply
bundle was split in v2026.4.2; `extractFileContentFromSource` moved to its own chunk).

**How** (after rebuild):
```bash
CONTAINER="openclaw-gateway"
INPUT_FILES=$(docker exec $CONTAINER grep -rl 'extractFileContentFromSource' /app/dist/input-files-*.js | head -1)
docker compose cp "openclaw-gateway:$INPUT_FILES" ~/openclaw/$(basename $INPUT_FILES)
# Apply binaryPassthroughMimes patch before the PDF check in extractFileContentFromSource
```

**Why still needed**: Upstream `extractFileContentFromSource` in `src/media/input-files.ts`
returns text-only for non-image/non-PDF files. No binary blob passthrough exists.

### 3. Pi-AI Provider Document Blocks (0.64.0)

**What**: Routes non-image MIME types correctly per provider:
- **Anthropic**: document blocks for supported types
- **OpenAI**: `input_file` blocks instead of `input_image`
- **Google**: `fileData` for documents, `inlineData` for images

**How** (after rebuild):
```bash
CONTAINER="openclaw-gateway"
# Discover the pnpm store path for pi-ai 0.64.0
PI_AI_PATH=$(docker exec $CONTAINER find /app/node_modules/.pnpm -path '*pi-ai*/dist/providers' -type d | head -1)
echo "Pi-AI providers at: $PI_AI_PATH"

# Copy providers from container
for f in anthropic.js openai-completions.js openai-responses-shared.js google-shared.js; do
  docker compose cp "openclaw-gateway:$PI_AI_PATH/$f" ~/openclaw/pi-ai-providers/${f}.new
  cp ~/openclaw/pi-ai-providers/${f}.new ~/openclaw/pi-ai-providers/${f}.new.bak
done

# IMPORTANT: The 0.64.0 provider files will differ from the 0.55.3 versions.
# You CANNOT reuse the old patched files directly. You must:
# 1. Diff the 0.55.3 .old vs patched to understand the logic changes
# 2. Apply the same logic to the 0.64.0 files
# 3. Reference files in ~/openclaw/pi-ai-providers/*.old (0.55.3 originals)
#    and ~/openclaw/pi-ai-providers/*.js (0.55.3 patched versions)
```

**Why still needed**: Pi-AI 0.64.0 still doesn't handle binary file passthrough
natively. The provider-level routing (image vs document block) remains absent.

**Key logic to port to 0.64.0**:
- `anthropic.js`: In `convertContentBlocks()`, detect `!mimeType.startsWith("image/")`
  and route to document blocks or skip unsupported types
- `openai-responses-shared.js`: Add `input_file` block type for non-image MIME types
- `openai-completions.js`: Filter non-image binary parts, add `input_file` support
- `google-shared.js`: Use `fileData` for documents instead of `inlineData`

## Patches REMOVED (Fixed Upstream)

| Patch | Why Removed |
|---|---|
| pi-embedded cooldown probe (`pi-embedded-DgYXShcG.js`, `pi-embedded-f5xR7MbI.js`) | `shouldProbePrimaryDuringCooldown()` in `model-fallback.ts` + WHAM-aware cooldown (`0b3d31c0ce`) |
| Redacted thinking (part of anthropic.js) | Upstream `31675d65d4` handles `redacted_thinking` blocks |
| Cross-contamination session scoping | Multiple upstream session isolation fixes |
| Compaction hook context (PR #24672) | Cherry-picked to main |
| Sonnet 4.6 thinking effort + interleavedBeta (anthropic.js) | Pi-AI 0.64.0 includes `supportsAdaptiveThinking` for Sonnet 4.6, model-aware `mapThinkingLevelToEffort`, conditional `needsInterleavedBeta`, and temperature gating with thinkingEnabled |

## Backup Locations

- Full patch backup: `~/.openclaw/fork-backup-2026-04-01/`
- v2026.3.2 patched files: `~/openclaw/pi-ai-providers/` (*.old = original, *.js = patched)
- Patch script: `~/openclaw/patch-gateway-bundles.sh`
- Old reply bundle: `~/openclaw/reply-DhtejUNZ.js`
- Old gateway bundles: `~/openclaw/gateway-cli-krBALB6-.js`, `gateway-cli-vk3t7zJU.js`
