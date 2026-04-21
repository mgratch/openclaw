#!/bin/bash
# extract-and-patch-all.sh — Extract + patch all runtime files for v2026.4.2
#
# Run from ~/openclaw/ after:
#   1. docker compose up -d   (or at least: docker run --rm openclaw:custom ...)
#
# This script:
#   1. Discovers new bundle filenames
#   2. Extracts gateway-cli, reply, and pi-ai provider files from the container
#   3. Patches gateway bundles (MAX_PAYLOAD + chat history)
#   4. Patches reply bundle (binary file passthrough)
#   5. Patches pi-ai providers (document block routing + thinking effort)
#   6. Updates docker-compose.override.yml with real paths
#
# Old v2026.3.2 files are preserved (*.old, etc.). New files get .v2026.4.2.orig backups.

set -euo pipefail
cd "$(dirname "$0")"

# Use the compose service name for docker compose cp
CONTAINER="openclaw-gateway"
COMPOSE_OVERRIDE="docker-compose.override.yml"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  OpenClaw v2026.4.2 — Runtime Patch Script                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PHASE 1: GATEWAY CLI BUNDLES
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo "━━━ Phase 1: Gateway CLI Bundles ━━━"
echo ""

echo "==> Discovering gateway-cli bundle filenames..."
BUNDLES=$(docker exec "$CONTAINER" find /app/dist -maxdepth 1 -name 'gateway-cli-*.js' -exec basename {} \;)

if [[ -z "$BUNDLES" ]]; then
  echo "ERROR: No gateway-cli-*.js files found. Is the container running?"
  echo "  Try: docker compose up -d"
  exit 1
fi

echo "    Found gateway-cli bundles:"
echo "$BUNDLES" | sed 's/^/      /'

echo ""
echo "==> Extracting gateway-cli bundles..."
while IFS= read -r bundle; do
  docker compose cp "${CONTAINER}:/app/dist/$bundle" "./$bundle"
  cp "$bundle" "${bundle}.v2026.4.2.orig"
  echo "    Extracted: $bundle"
done <<< "$BUNDLES"

echo ""
echo "==> Patching MAX_PAYLOAD_BYTES (25MB → 1GB)..."
while IFS= read -r bundle; do
  sed -i '' 's/const MAX_PAYLOAD_BYTES = 25 \* 1024 \* 1024;/const MAX_PAYLOAD_BYTES = 1024 * 1024 * 1024;/' "$bundle"
done <<< "$BUNDLES"

echo "==> Patching DEFAULT_MAX_CHAT_HISTORY_MESSAGES_BYTES (6MB → 500MB)..."
while IFS= read -r bundle; do
  sed -i '' 's/const DEFAULT_MAX_CHAT_HISTORY_MESSAGES_BYTES = 6 \* 1024 \* 1024;/const DEFAULT_MAX_CHAT_HISTORY_MESSAGES_BYTES = 500 * 1024 * 1024;/' "$bundle"
done <<< "$BUNDLES"

echo "==> Verifying gateway-cli patches..."
GATEWAY_OK=true
while IFS= read -r bundle; do
  if grep -q '1024 \* 1024 \* 1024' "$bundle"; then
    echo "    ✓ $bundle patched"
  else
    echo "    ✗ $bundle — patch may not have applied!"
    GATEWAY_OK=false
  fi
done <<< "$BUNDLES"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PHASE 2: REPLY BUNDLE (Binary File Pass-Through)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "━━━ Phase 2: Reply Bundle ━━━"
echo ""

echo "==> Discovering reply bundle filename..."
REPLY=$(docker exec "$CONTAINER" find /app/dist -maxdepth 1 -name 'reply-*.js' -exec basename {} \;)

if [[ -z "$REPLY" ]]; then
  echo "ERROR: No reply-*.js found in container."
  exit 1
fi

echo "    Found: $REPLY"

echo ""
echo "==> Extracting reply bundle..."
docker compose cp "${CONTAINER}:/app/dist/$REPLY" "./$REPLY"
cp "$REPLY" "${REPLY}.v2026.4.2.orig"
echo "    Extracted: $REPLY"

echo ""
echo "==> Reply bundle extracted. Patch will be applied by the patch-reply.js node script."
echo "    (Binary passthrough patch requires AST-aware insertion — too complex for sed)"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PHASE 3: PI-AI PROVIDERS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "━━━ Phase 3: Pi-AI Provider Files ━━━"
echo ""

echo "==> Discovering pi-ai provider path..."
PI_AI_PATH=$(docker exec "$CONTAINER" find /app/node_modules/.pnpm -path '*pi-ai*/dist/providers' -type d 2>/dev/null | head -1)

if [[ -z "$PI_AI_PATH" ]]; then
  # Fallback: try direct node_modules
  PI_AI_PATH=$(docker exec "$CONTAINER" find /app/node_modules -path '*pi-ai*/dist/providers' -type d 2>/dev/null | head -1)
fi

if [[ -z "$PI_AI_PATH" ]]; then
  echo "ERROR: Could not find pi-ai providers directory in container."
  echo "  Check: docker exec $CONTAINER find /app/node_modules -name 'anthropic.js' -path '*pi-ai*'"
  exit 1
fi

echo "    Found: $PI_AI_PATH"

# Save the store path for docker-compose.override.yml
PI_AI_STORE_PATH="$PI_AI_PATH"
echo "$PI_AI_STORE_PATH" > .pi-ai-store-path

echo ""
echo "==> Extracting pi-ai 0.64.0 provider files..."
mkdir -p pi-ai-providers
for f in anthropic.js openai-completions.js openai-responses-shared.js google-shared.js; do
  docker compose cp "${CONTAINER}:${PI_AI_PATH}/$f" "./pi-ai-providers/${f}.v0.64.0.orig"
  cp "./pi-ai-providers/${f}.v0.64.0.orig" "./pi-ai-providers/${f}"
  echo "    Extracted: $f"
done

echo ""
echo "==> Pi-AI provider files extracted. Patches will be applied next."

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PHASE 4: PI-AI PROVIDER PATCHES (sed-based)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "━━━ Phase 4: Pi-AI Provider Patches ━━━"
echo ""

# ── anthropic.js patches ──

echo "==> Patching anthropic.js..."
AFILE="pi-ai-providers/anthropic.js"

# 4a. supportsAdaptiveThinking — add Sonnet 4.6
# Original pattern: return modelId.includes("opus-4-6") || modelId.includes("opus-4.6");
# Target: also include sonnet-4-6/sonnet-4.6
if grep -q 'return modelId.includes("opus-4-6") || modelId.includes("opus-4.6");' "$AFILE"; then
  sed -i '' 's/return modelId\.includes("opus-4-6") || modelId\.includes("opus-4\.6");/return (modelId.includes("opus-4-6") || modelId.includes("opus-4.6") || modelId.includes("sonnet-4-6") || modelId.includes("sonnet-4.6"));/' "$AFILE"
  echo "    ✓ supportsAdaptiveThinking — added Sonnet 4.6"
else
  echo "    ⚠ supportsAdaptiveThinking — pattern not found (may already include Sonnet 4.6)"
  if grep -q 'sonnet-4' "$AFILE"; then
    echo "      (file already references sonnet-4 — likely already patched upstream)"
  fi
fi

# 4b. mapThinkingLevelToEffort — "max" only for Opus 4.6
# Original: case "xhigh": return "max";
# Target: return "max" only for opus, "high" for others
if grep -q 'function mapThinkingLevelToEffort(level)' "$AFILE"; then
  # Change function signature to accept modelId
  sed -i '' 's/function mapThinkingLevelToEffort(level)/function mapThinkingLevelToEffort(level, modelId)/' "$AFILE"
  # Change xhigh case to be model-aware
  sed -i '' 's/case "xhigh":\s*$/case "xhigh":/' "$AFILE"
  sed -i '' '/case "xhigh":/{ n; s/return "max";/return modelId.includes("opus-4-6") || modelId.includes("opus-4.6") ? "max" : "high";/; }' "$AFILE"
  echo "    ✓ mapThinkingLevelToEffort — model-aware (max only for Opus)"
elif grep -q 'function mapThinkingLevelToEffort(level, modelId)' "$AFILE"; then
  echo "    ⚠ mapThinkingLevelToEffort — already has modelId parameter (checking xhigh)"
  if grep -q 'return "max"' "$AFILE"; then
    echo "      Still returns unconditional 'max' — patching xhigh case"
    sed -i '' '/case "xhigh":/{ n; s/return "max";/return modelId.includes("opus-4-6") || modelId.includes("opus-4.6") ? "max" : "high";/; }' "$AFILE"
  fi
else
  echo "    ⚠ mapThinkingLevelToEffort — function not found (may have been refactored)"
fi

# 4c. Update mapThinkingLevelToEffort call site to pass model.id
if grep -q 'mapThinkingLevelToEffort(options.reasoning)' "$AFILE"; then
  sed -i '' 's/mapThinkingLevelToEffort(options\.reasoning)/mapThinkingLevelToEffort(options.reasoning, model.id)/' "$AFILE"
  echo "    ✓ mapThinkingLevelToEffort call — now passes model.id"
elif grep -q 'mapThinkingLevelToEffort(options.reasoning, model.id)' "$AFILE"; then
  echo "    ⚠ mapThinkingLevelToEffort call — already passes model.id"
else
  # Try alternate patterns
  if grep -q 'mapThinkingLevelToEffort(options?.reasoning)' "$AFILE"; then
    sed -i '' 's/mapThinkingLevelToEffort(options?\.reasoning)/mapThinkingLevelToEffort(options?.reasoning, model.id)/' "$AFILE"
    echo "    ✓ mapThinkingLevelToEffort call (optional) — now passes model.id"
  else
    echo "    ⚠ mapThinkingLevelToEffort call — pattern not found"
  fi
fi

# 4d. Conditional interleavedBeta — skip for models with built-in thinking
if grep -q 'if (interleavedThinking) {' "$AFILE" && ! grep -q 'needsInterleavedBeta' "$AFILE"; then
  sed -i '' 's/if (interleavedThinking) {/const needsInterleavedBeta = interleavedThinking \&\& !supportsAdaptiveThinking(model.id);\
    if (needsInterleavedBeta) {/' "$AFILE"
  echo "    ✓ interleavedBeta — conditional on model support"
elif grep -q 'needsInterleavedBeta' "$AFILE"; then
  echo "    ⚠ interleavedBeta — already conditional"
else
  echo "    ⚠ interleavedBeta — pattern not found"
fi

# 4e. Temperature gating with thinking mode
if grep -q 'if (options?.temperature !== undefined) {' "$AFILE" && ! grep -q 'thinkingEnabled' "$AFILE"; then
  sed -i '' 's/if (options?.temperature !== undefined) {/if (options?.temperature !== undefined \&\& !options?.thinkingEnabled) {/' "$AFILE"
  echo "    ✓ Temperature — gated with thinking mode"
elif grep -q 'thinkingEnabled' "$AFILE"; then
  echo "    ⚠ Temperature — already gated with thinkingEnabled"
else
  echo "    ⚠ Temperature gating — pattern not found"
fi

# ── openai-completions.js patches ──

echo ""
echo "==> Patching openai-completions.js..."
OFILE="pi-ai-providers/openai-completions.js"

# 4f. Optional chaining on choices[0]
if grep -q 'const choice = chunk\.choices\[0\];' "$OFILE"; then
  sed -i '' 's/const choice = chunk\.choices\[0\];/const choice = chunk.choices?.[0];/' "$OFILE"
  echo "    ✓ Optional chaining on choices[0]"
elif grep -q 'chunk\.choices?\.\[0\]' "$OFILE"; then
  echo "    ⚠ Already has optional chaining"
else
  echo "    ⚠ choices[0] pattern not found"
fi

# 4g. File type routing — non-image MIME → file block instead of image_url
# Look for the image_url block and add a non-image check before it
if grep -q 'type: "image_url"' "$OFILE" && ! grep -q 'type: "file"' "$OFILE"; then
  # Insert non-image file block before the image_url fallback
  # Pattern: else { return { type: "image_url", image_url: { url: `data:${item.mimeType}...
  sed -i '' '/else {/{
    N
    /type: "image_url"/i\
    else if (item.mimeType \&\& !item.mimeType.startsWith("image/")) {\
        return {\
            type: "file",\
            file: {\
                file_data: `data:${item.mimeType};base64,${item.data}`,\
                filename: item.filename || "file",\
            },\
        };\
    }
  }' "$OFILE"
  echo "    ✓ File type routing — non-image → file block"
elif grep -q 'type: "file"' "$OFILE"; then
  echo "    ⚠ File type routing — already has file block"
else
  echo "    ⚠ File type routing — image_url pattern not found"
fi

# ── google-shared.js patches ──

echo ""
echo "==> Patching google-shared.js..."
GFILE="pi-ai-providers/google-shared.js"

# 4h. Allow non-image inlineData through part filtering
# Original: parts.filter((p) => p.text !== undefined)
# Target: also keep inlineData with non-image mimeType
if grep -q 'parts\.filter((p) => p\.text !== undefined)' "$GFILE"; then
  sed -i '' 's/parts\.filter((p) => p\.text !== undefined)/parts.filter((p) => p.text !== undefined || (p.inlineData \&\& !p.inlineData.mimeType.startsWith("image\/")))/' "$GFILE"
  echo "    ✓ Part filtering — allows non-image inlineData"
elif grep -q 'p\.inlineData' "$GFILE"; then
  echo "    ⚠ Part filtering — already handles inlineData"
else
  echo "    ⚠ Part filtering — pattern not found"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PHASE 5: UPDATE DOCKER-COMPOSE.OVERRIDE.YML
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "━━━ Phase 5: Update docker-compose.override.yml ━━━"
echo ""

# Back up
cp "$COMPOSE_OVERRIDE" "${COMPOSE_OVERRIDE}.bak-$(date +%Y%m%d-%H%M%S)"

# Build volume mount lines
TMPFILE=$(mktemp)
{
  echo "      # Patched gateway bundles (MAX_PAYLOAD_BYTES 25MB→1GB + chat history 6MB→500MB)"
  while IFS= read -r bundle; do
    echo "      - \${HOME}/openclaw/${bundle}:/app/dist/${bundle}:ro"
  done <<< "$BUNDLES"
  echo "      # Patched reply bundle (binary file pass-through)"
  echo "      - \${HOME}/openclaw/${REPLY}:/app/dist/${REPLY}:ro"
  echo "      # Patched pi-ai providers (document block routing + thinking effort)"
  for f in anthropic.js openai-completions.js openai-responses-shared.js google-shared.js; do
    echo "      - \${HOME}/openclaw/pi-ai-providers/${f}:${PI_AI_STORE_PATH}/${f}:ro"
  done
} > "$TMPFILE"

# Remove old FIXME placeholder lines and any previous mount lines for these files
sed -i '' '/gateway-cli-.*\.js:\/app\/dist\/gateway-cli/d' "$COMPOSE_OVERRIDE"
sed -i '' '/reply-.*\.js:\/app\/dist\/reply/d' "$COMPOSE_OVERRIDE"
sed -i '' '/pi-ai-providers\/.*\.js:.*pi-ai/d' "$COMPOSE_OVERRIDE"

# Remove old comment lines that we'll replace
sed -i '' '/# Patched gateway bundles/d' "$COMPOSE_OVERRIDE"
sed -i '' '/# Patched reply bundle/d' "$COMPOSE_OVERRIDE"
sed -i '' '/# Patched pi-ai providers/d' "$COMPOSE_OVERRIDE"
sed -i '' '/# NOTE: pnpm store path/d' "$COMPOSE_OVERRIDE"
sed -i '' '/# POST-REBUILD:/d' "$COMPOSE_OVERRIDE"
sed -i '' '/# ── POST-REBUILD:/d' "$COMPOSE_OVERRIDE"

# Find insertion point: before "Lando CA cert" or before "REMOVED" comment
INSERT_LINE=$(grep -n '# Lando CA cert\|# ── REMOVED:' "$COMPOSE_OVERRIDE" | head -1 | cut -d: -f1)

if [[ -n "$INSERT_LINE" ]]; then
  sed -i '' "$((INSERT_LINE - 1))r $TMPFILE" "$COMPOSE_OVERRIDE"
  echo "    ✓ Inserted volume mounts in $COMPOSE_OVERRIDE"
else
  echo "    ⚠ Could not find insertion point. Add these manually:"
  cat "$TMPFILE"
fi

rm -f "$TMPFILE"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SUMMARY
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Extraction + Patching Complete                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Files extracted:"
echo "  Gateway: $BUNDLES"
echo "  Reply:   $REPLY"
echo "  Pi-AI:   $PI_AI_STORE_PATH"
echo ""
echo "⚠ IMPORTANT: The reply bundle binary passthrough patch was NOT"
echo "  applied by this script (too complex for sed on minified JS)."
echo "  Run the separate patch-reply.js script next, or have Claude"
echo "  inspect the extracted file and create the patch."
echo ""
echo "Next steps:"
echo "  1. Verify: review any ⚠ warnings above"
echo "  2. Reply patch: see note above"
echo "  3. Restart: docker compose down && docker compose up -d"
echo "  4. Verify inside container:"
echo "     docker exec $CONTAINER grep -c 'MAX_PAYLOAD_BYTES = 1024' /app/dist/gateway-cli-*.js"
echo ""
echo "Pi-AI store path saved to: .pi-ai-store-path"
echo "  (contents: $PI_AI_STORE_PATH)"
