#!/bin/bash
# extract-reply-and-providers.sh — Phase 2+3+5 from extract-and-patch-all.sh
# Gateway bundles already done. This handles reply + pi-ai + compose update.
set -euo pipefail
cd "$(dirname "$0")"

CONTAINER="openclaw-gateway"
COMPOSE_OVERRIDE="docker-compose.override.yml"

echo "━━━ Phase 2: Reply Bundle (split in v2026.4.2) ━━━"
echo ""

# In v2026.4.2, reply-*.js was split into many files.
# Find the one containing extractFileContentFromSource
echo "==> Finding reply file with extractFileContentFromSource..."
REPLY_FILE=$(docker exec "$CONTAINER" grep -rl 'extractFileContentFromSource' /app/dist/reply-*.js 2>/dev/null | head -1)

if [[ -z "$REPLY_FILE" ]]; then
  # Try broader search
  REPLY_FILE=$(docker exec "$CONTAINER" grep -rl 'extractFileContentFromSource' /app/dist/ 2>/dev/null | grep 'reply' | head -1)
fi

if [[ -z "$REPLY_FILE" ]]; then
  echo "    ⚠ extractFileContentFromSource not found in any reply-*.js"
  echo "    Searching all dist files..."
  REPLY_FILE=$(docker exec "$CONTAINER" grep -rl 'extractFileContentFromSource' /app/dist/ 2>/dev/null | head -1)
  if [[ -n "$REPLY_FILE" ]]; then
    echo "    Found in: $REPLY_FILE"
  else
    echo "    ERROR: extractFileContentFromSource not found anywhere in /app/dist/"
    echo "    It may have moved to a different module. Check with:"
    echo "      docker exec $CONTAINER grep -rl 'extractFileContentFromSource' /app/"
  fi
fi

if [[ -n "$REPLY_FILE" ]]; then
  REPLY_BASENAME=$(basename "$REPLY_FILE")
  echo "    Found: $REPLY_BASENAME"

  echo ""
  echo "==> Extracting $REPLY_BASENAME..."
  docker compose cp "${CONTAINER}:${REPLY_FILE}" "./${REPLY_BASENAME}"
  cp "$REPLY_BASENAME" "${REPLY_BASENAME}.v2026.4.2.orig"
  echo "    ✓ Extracted: $REPLY_BASENAME"
  echo "$REPLY_BASENAME" > .reply-bundle-name
else
  echo "    Skipping reply extraction."
  echo "" > .reply-bundle-name
fi

# Also list ALL reply files for reference
echo ""
echo "==> All reply-*.js files in v2026.4.2:"
docker exec "$CONTAINER" ls -la /app/dist/reply-*.js 2>/dev/null | awk '{print "    " $NF}'

echo ""
echo "━━━ Phase 3: Pi-AI Provider Files ━━━"
echo ""

echo "==> Discovering pi-ai provider path..."
PI_AI_PATH=$(docker exec "$CONTAINER" find /app/node_modules/.pnpm -path '*pi-ai*/dist/providers' -type d 2>/dev/null | head -1)

if [[ -z "$PI_AI_PATH" ]]; then
  PI_AI_PATH=$(docker exec "$CONTAINER" find /app/node_modules -path '*pi-ai*/dist/providers' -type d 2>/dev/null | head -1)
fi

if [[ -z "$PI_AI_PATH" ]]; then
  echo "ERROR: Could not find pi-ai providers in container."
  exit 1
fi

echo "    Found: $PI_AI_PATH"
echo "$PI_AI_PATH" > .pi-ai-store-path

echo ""
echo "==> Extracting pi-ai provider files..."
mkdir -p pi-ai-providers
for f in anthropic.js openai-completions.js openai-responses-shared.js google-shared.js; do
  docker compose cp "${CONTAINER}:${PI_AI_PATH}/$f" "./pi-ai-providers/${f}.v0.64.0.orig"
  cp "./pi-ai-providers/${f}.v0.64.0.orig" "./pi-ai-providers/${f}"
  echo "    ✓ $f"
done

echo ""
echo "━━━ Phase 4: Pi-AI Provider Patches ━━━"
echo ""

# ── anthropic.js ──
echo "==> Patching anthropic.js..."
AFILE="pi-ai-providers/anthropic.js"

# supportsAdaptiveThinking — add Sonnet 4.6
if grep -q 'return modelId.includes("opus-4-6") || modelId.includes("opus-4.6");' "$AFILE"; then
  sed -i '' 's/return modelId\.includes("opus-4-6") || modelId\.includes("opus-4\.6");/return (modelId.includes("opus-4-6") || modelId.includes("opus-4.6") || modelId.includes("sonnet-4-6") || modelId.includes("sonnet-4.6"));/' "$AFILE"
  echo "    ✓ supportsAdaptiveThinking — added Sonnet 4.6"
else
  echo "    ⚠ supportsAdaptiveThinking — pattern not found (may already include Sonnet)"
  grep -n 'supportsAdaptiveThinking' "$AFILE" | head -3 | sed 's/^/      /'
fi

# mapThinkingLevelToEffort — model-aware
if grep -q 'function mapThinkingLevelToEffort(level)' "$AFILE"; then
  sed -i '' 's/function mapThinkingLevelToEffort(level)/function mapThinkingLevelToEffort(level, modelId)/' "$AFILE"
  # xhigh → max only for Opus
  sed -i '' '/case "xhigh":/{n;s/return "max";/return modelId.includes("opus-4-6") || modelId.includes("opus-4.6") ? "max" : "high";/;}' "$AFILE"
  echo "    ✓ mapThinkingLevelToEffort — model-aware"
elif grep -q 'function mapThinkingLevelToEffort(level, modelId)' "$AFILE"; then
  echo "    ⚠ mapThinkingLevelToEffort — already model-aware"
else
  echo "    ⚠ mapThinkingLevelToEffort — not found"
fi

# Update call site
if grep -q 'mapThinkingLevelToEffort(options.reasoning)' "$AFILE"; then
  sed -i '' 's/mapThinkingLevelToEffort(options\.reasoning)/mapThinkingLevelToEffort(options.reasoning, model.id)/' "$AFILE"
  echo "    ✓ Call site — passes model.id"
elif grep -q 'mapThinkingLevelToEffort(options?.reasoning)' "$AFILE"; then
  sed -i '' 's/mapThinkingLevelToEffort(options?\.reasoning)/mapThinkingLevelToEffort(options?.reasoning, model.id)/' "$AFILE"
  echo "    ✓ Call site (optional) — passes model.id"
else
  echo "    ⚠ Call site — pattern not found"
fi

# Conditional interleavedBeta
if grep -q 'if (interleavedThinking) {' "$AFILE" && ! grep -q 'needsInterleavedBeta' "$AFILE"; then
  sed -i '' 's/if (interleavedThinking) {/const needsInterleavedBeta = interleavedThinking \&\& !supportsAdaptiveThinking(model.id);\
    if (needsInterleavedBeta) {/' "$AFILE"
  echo "    ✓ interleavedBeta — conditional"
elif grep -q 'needsInterleavedBeta' "$AFILE"; then
  echo "    ⚠ interleavedBeta — already conditional"
else
  echo "    ⚠ interleavedBeta — pattern not found"
fi

# Temperature gating
if grep -q 'if (options?.temperature !== undefined) {' "$AFILE" && ! grep -q 'thinkingEnabled' "$AFILE"; then
  sed -i '' 's/if (options?.temperature !== undefined) {/if (options?.temperature !== undefined \&\& !options?.thinkingEnabled) {/' "$AFILE"
  echo "    ✓ Temperature — gated with thinking"
elif grep -q 'thinkingEnabled' "$AFILE"; then
  echo "    ⚠ Temperature — already gated"
else
  echo "    ⚠ Temperature — pattern not found"
fi

# ── openai-completions.js ──
echo ""
echo "==> Patching openai-completions.js..."
OFILE="pi-ai-providers/openai-completions.js"

if grep -q 'const choice = chunk\.choices\[0\];' "$OFILE"; then
  sed -i '' 's/const choice = chunk\.choices\[0\];/const choice = chunk.choices?.[0];/' "$OFILE"
  echo "    ✓ Optional chaining on choices[0]"
else
  echo "    ⚠ choices[0] — pattern not found or already patched"
fi

# File type routing
if grep -q 'type: "image_url"' "$OFILE" && ! grep -q 'type: "file"' "$OFILE"; then
  echo "    ⚠ File type routing needs manual patch (see pi-ai-providers/openai-completions.js)"
  echo "      Look for the else { type: \"image_url\" } block and add non-image check before it"
else
  if grep -q 'type: "file"' "$OFILE"; then
    echo "    ✓ File type routing — already has file block"
  else
    echo "    ⚠ File type routing — image_url not found"
  fi
fi

# ── google-shared.js ──
echo ""
echo "==> Patching google-shared.js..."
GFILE="pi-ai-providers/google-shared.js"

if grep -q 'parts\.filter((p) => p\.text !== undefined)' "$GFILE"; then
  sed -i '' 's/parts\.filter((p) => p\.text !== undefined)/parts.filter((p) => p.text !== undefined || (p.inlineData \&\& !p.inlineData.mimeType.startsWith("image\/")))/' "$GFILE"
  echo "    ✓ Part filtering — allows non-image inlineData"
else
  echo "    ⚠ Part filtering — pattern not found"
fi

echo ""
echo "━━━ Phase 5: Update docker-compose.override.yml ━━━"
echo ""

cp "$COMPOSE_OVERRIDE" "${COMPOSE_OVERRIDE}.bak-$(date +%Y%m%d-%H%M%S)"

# Read saved values
GATEWAY_BUNDLE=$(ls gateway-cli-Cyl5JtYE.js 2>/dev/null || docker exec "$CONTAINER" find /app/dist -maxdepth 1 -name 'gateway-cli-*.js' -exec basename {} \; | head -1)
REPLY_BUNDLE=$(cat .reply-bundle-name 2>/dev/null || echo "")
PI_AI_STORE=$(cat .pi-ai-store-path 2>/dev/null || echo "")

TMPFILE=$(mktemp)
{
  echo "      # Patched gateway bundles (MAX_PAYLOAD_BYTES 25MB→1GB + chat history 6MB→500MB)"
  echo "      - \${HOME}/openclaw/${GATEWAY_BUNDLE}:/app/dist/${GATEWAY_BUNDLE}:ro"
  if [[ -n "$REPLY_BUNDLE" ]]; then
    echo "      # Patched reply bundle (binary file pass-through)"
    echo "      - \${HOME}/openclaw/${REPLY_BUNDLE}:/app/dist/${REPLY_BUNDLE}:ro"
  fi
  if [[ -n "$PI_AI_STORE" ]]; then
    echo "      # Patched pi-ai providers (document block routing + thinking effort)"
    for f in anthropic.js openai-completions.js openai-responses-shared.js google-shared.js; do
      echo "      - \${HOME}/openclaw/pi-ai-providers/${f}:${PI_AI_STORE}/${f}:ro"
    done
  fi
} > "$TMPFILE"

# Clean old entries
sed -i '' '/gateway-cli-.*\.js:\/app\/dist\/gateway-cli/d' "$COMPOSE_OVERRIDE"
sed -i '' '/reply-.*\.js:\/app\/dist\/reply/d' "$COMPOSE_OVERRIDE"
sed -i '' '/pi-ai-providers\/.*\.js:.*pi-ai/d' "$COMPOSE_OVERRIDE"
sed -i '' '/# Patched gateway bundles/d' "$COMPOSE_OVERRIDE"
sed -i '' '/# Patched reply bundle/d' "$COMPOSE_OVERRIDE"
sed -i '' '/# Patched pi-ai providers/d' "$COMPOSE_OVERRIDE"
sed -i '' '/# NOTE: pnpm store path/d' "$COMPOSE_OVERRIDE"
sed -i '' '/# POST-REBUILD/d' "$COMPOSE_OVERRIDE"
sed -i '' '/# ── POST-REBUILD/d' "$COMPOSE_OVERRIDE"

INSERT_LINE=$(grep -n '# Lando CA cert\|# ── REMOVED:' "$COMPOSE_OVERRIDE" | head -1 | cut -d: -f1)

if [[ -n "$INSERT_LINE" ]]; then
  sed -i '' "$((INSERT_LINE - 1))r $TMPFILE" "$COMPOSE_OVERRIDE"
  echo "    ✓ Updated volume mounts"
else
  echo "    ⚠ Insert manually:"
  cat "$TMPFILE"
fi

rm -f "$TMPFILE"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Done! Review ⚠ warnings above, then:                       ║"
echo "║    docker compose down && docker compose up -d               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
