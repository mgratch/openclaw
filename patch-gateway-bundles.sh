#!/bin/bash
# patch-gateway-bundles.sh — Extract fresh hashed bundles from openclaw image,
# apply Layer B runtime patches, and sync docker-compose.override.yml.
#
# Bundles patched:
#   1. gateway-cli-*.js       MAX_PAYLOAD_BYTES 25MB → 1GB + chat history 6MB → 500MB
#   2. thinking.shared-*.js   xhigh for the config-defined SOL model
#
# NOTE: auth-profiles Layer B mount is REMOVED — the OAuth refresh dedup logic
# is now baked into src/agents/auth-profiles/oauth.ts and ships in the image.
#
# NOTE: input-files Layer B mount is REMOVED (2026-09-09). It injected a
# binaryPassthroughMimes Set that returned { rawBase64, rawMimeType } to dodge
# the "Unsupported file MIME type" throw — but no caller ever read those fields,
# so binaries stopped erroring and silently produced nothing. Superseded by
# Layer A: allowedMimes ["*/*"] disables the allowlist for ANY type, and
# unreadable payloads come back as a visible "[binary file: ...]" placeholder.
#
# Filename hashes change every build. This script auto-discovers them from
# the built image, extracts fresh unpatched bundles, re-applies the patches,
# and updates docker-compose.override.yml mount paths.
#
# Usage:
#   Run from ~/openclaw/ after any rebuild of openclaw:local / openclaw:custom.
#   ./patch-gateway-bundles.sh [IMAGE_TAG]
#
# IMAGE_TAG defaults to openclaw:local. Use openclaw:custom if you want to
# pull bundles from the custom image instead (they're identical for /app/dist
# contents since Dockerfile.custom doesn't modify dist).

set -euo pipefail
cd "$(dirname "$0")"

IMAGE_TAG="${1:-openclaw:local}"
COMPOSE_OVERRIDE="docker-compose.override.yml"
EXTRACT_CONTAINER="openclaw-bundle-extract-$$"

cleanup() {
  docker rm -f "$EXTRACT_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Using image: $IMAGE_TAG"

# ─── Step 1: Create a throwaway container and discover bundle names ───────
echo ""
echo "==> Discovering bundle filenames in $IMAGE_TAG..."
docker create --name "$EXTRACT_CONTAINER" "$IMAGE_TAG" >/dev/null

GATEWAY_BUNDLE=$(docker cp "$EXTRACT_CONTAINER:/app/dist/" - | tar -t 2>/dev/null | grep -oE 'dist/gateway-cli-[A-Za-z0-9_-]+\.js$' | head -1 | xargs basename)
THINKING_BUNDLE=$(docker cp "$EXTRACT_CONTAINER:/app/dist/" - | tar -t 2>/dev/null | grep -oE 'dist/thinking\.shared-[A-Za-z0-9_-]+\.js$' | head -1 | xargs basename)

for var in GATEWAY_BUNDLE THINKING_BUNDLE; do
  if [[ -z "${!var}" ]]; then
    echo "ERROR: Could not discover $var in $IMAGE_TAG:/app/dist/"
    exit 1
  fi
done

echo "    gateway-cli:      $GATEWAY_BUNDLE"
echo "    thinking.shared:  $THINKING_BUNDLE"
echo "    auth-profiles: (removed — now Layer A in src/agents/auth-profiles/oauth.ts)"
echo "    input-files:   (removed — superseded by Layer A allowedMimes wildcard)"

# ─── Step 2: Remove any stale patched bundles from previous rebuilds ──────
echo ""
echo "==> Cleaning stale patched bundles..."
shopt -s nullglob
for pattern in 'gateway-cli-*.js' 'input-files-*.js' 'auth-profiles-*.js' 'thinking.shared-*.js'; do
  for old in $pattern; do
    # Keep the one we're about to regenerate
    case "$old" in
      "$GATEWAY_BUNDLE"|"$THINKING_BUNDLE") continue ;;
    esac
    # Also keep .bak and .unpatched variants in case user wants them for debugging
    case "$old" in
      *.bak|*.unpatched) continue ;;
    esac
    # Docker Desktop creates a directory at a missing bind-mount source path.
    # Remove those stale mount stubs without changing the normal file cleanup.
    if [ -d "$old" ] && [ ! -L "$old" ]; then
      echo "    rmdir $old (stale Docker mount directory)"
      rmdir "$old"
    else
      echo "    rm $old"
      rm -f "$old"
    fi
  done
done
shopt -u nullglob

# ─── Step 3: Extract fresh unpatched bundles ──────────────────────────────
echo ""
echo "==> Extracting fresh unpatched bundles..."
for bundle in "$GATEWAY_BUNDLE" "$THINKING_BUNDLE"; do
  docker cp "$EXTRACT_CONTAINER:/app/dist/$bundle" "./$bundle"
  cp "./$bundle" "./$bundle.unpatched"
  echo "    extracted: $bundle ($(wc -c < "$bundle") bytes)"
done

# ─── Step 4: Patch gateway-cli (MAX_PAYLOAD_BYTES + chat history) ────────
echo ""
echo "==> Patching $GATEWAY_BUNDLE..."
# NOTE: DEFAULT_MAX_CHAT_HISTORY_MESSAGES_BYTES is an unexported module-local const
# in src/gateway/server-constants.ts, so esbuild inlines it into the sole reference:
#   let maxChatHistoryMessagesBytes = 6 * 1024 * 1024;
# That inlined assignment is what we patch — NOT the original const declaration.
sed -i '' 's/const MAX_PAYLOAD_BYTES = 25 \* 1024 \* 1024;/const MAX_PAYLOAD_BYTES = 1024 * 1024 * 1024;/' "$GATEWAY_BUNDLE"
sed -i '' 's/let maxChatHistoryMessagesBytes = 6 \* 1024 \* 1024;/let maxChatHistoryMessagesBytes = 500 * 1024 * 1024;/' "$GATEWAY_BUNDLE"

if grep -q "MAX_PAYLOAD_BYTES = 1024 \* 1024 \* 1024" "$GATEWAY_BUNDLE" \
   && grep -q "let maxChatHistoryMessagesBytes = 500 \* 1024 \* 1024" "$GATEWAY_BUNDLE"; then
  echo "    OK: both gateway-cli constants patched (MAX_PAYLOAD + chat history)"
else
  echo "    FAIL: gateway-cli patches did not apply cleanly"
  echo "    Hint: the sed patterns may need updating if upstream changed the constant format"
  grep -n 'MAX_PAYLOAD_BYTES\|maxChatHistoryMessagesBytes' "$GATEWAY_BUNDLE" | head -10
  exit 1
fi

# ─── Step 5b: Patch thinking.shared (xhigh for config-defined SOL model) ──
echo ""
echo "==> Patching $THINKING_BUNDLE..."
node - "$THINKING_BUNDLE" <<'PATCH_THINKING'
const fs = require("node:fs");
const file = process.argv[2];
let src = fs.readFileSync(file, "utf8");

if (src.includes('"gpt-5.6-sol"')) {
  console.log("    already patched (gpt-5.6-sol present), skipping");
  process.exit(0);
}
// NOTE: if a future rebuild's Layer A source (src/auto-reply/thinking.shared.ts)
// already contains gpt-5.6-sol, the check above makes this a no-op.
const anchor = "OPENAI_CODEX_XHIGH_MODEL_IDS = [";
if (!src.includes(anchor)) {
  console.error("    FAIL: could not locate OPENAI_CODEX_XHIGH_MODEL_IDS anchor");
  process.exit(2);
}
src = src.replace(anchor, anchor + '\n  "gpt-5.6-sol",');
fs.writeFileSync(file, src);
console.log('    OK: "gpt-5.6-sol" added to OPENAI_CODEX_XHIGH_MODEL_IDS');
PATCH_THINKING

# ─── Step 6: Update docker-compose.override.yml mount paths ──────────────
echo ""
echo "==> Syncing $COMPOSE_OVERRIDE mount paths..."
if [[ ! -f "$COMPOSE_OVERRIDE" ]]; then
  echo "    WARNING: $COMPOSE_OVERRIDE not found — skipping mount-path update"
else
  cp "$COMPOSE_OVERRIDE" "${COMPOSE_OVERRIDE}.bak-$(date +%Y%m%d-%H%M%S)"

  # Replace any existing hashed filename references with the fresh ones.
  # pi-ai paths use stable names and don't need rewriting unless the pi-ai version bumps.
  sed -i '' -E "s#(openclaw/|/app/dist/)gateway-cli-[A-Za-z0-9_-]+\.js#\1${GATEWAY_BUNDLE}#g" "$COMPOSE_OVERRIDE"
  sed -i '' -E "s#(openclaw/|/app/dist/)thinking\.shared-[A-Za-z0-9_-]+\.js#\1${THINKING_BUNDLE}#g" "$COMPOSE_OVERRIDE"

  echo "    OK: mount paths updated (backup at ${COMPOSE_OVERRIDE}.bak-*)"
fi

# ─── Step 7: Final summary ──────────────────────────────────────────────
echo ""
echo "==> Done. Patched bundles ready:"
echo "    ${GATEWAY_BUNDLE}     (gateway-cli: payload + chat history limits)"
echo "    ${THINKING_BUNDLE} (thinking.shared: gpt-5.6-sol xhigh allowlist)"
echo "    (auth-profiles OAuth dedup is now Layer A — baked into the image)"
echo ""
echo "Next:"
echo "    docker compose down"
echo "    docker compose up -d openclaw-gateway"
echo "    # Verify Layer B patches in running container:"
echo "    docker compose exec openclaw-gateway grep -c '1024 \\* 1024 \\* 1024' /app/dist/${GATEWAY_BUNDLE}"
echo "    docker compose exec openclaw-gateway grep -c '500 \\* 1024 \\* 1024' /app/dist/${GATEWAY_BUNDLE}"
echo "    # Verify Layer A OAuth dedup (in any of the gateway chunks):"
echo "    docker compose exec openclaw-gateway sh -c 'grep -lc pendingOAuthRefreshes /app/dist/*.js | head'"
