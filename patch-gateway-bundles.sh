#!/bin/bash
# patch-gateway-bundles.sh — Extract fresh hashed bundles from openclaw image,
# apply Layer B runtime patches, and sync docker-compose.override.yml.
#
# Bundles patched:
#   1. gateway-cli-*.js     MAX_PAYLOAD_BYTES 25MB → 1GB + chat history 6MB → 500MB
#   2. input-files-*.js     binaryPassthroughMimes Set + rawBase64/rawMimeType return
#
# NOTE: auth-profiles Layer B mount is REMOVED — the OAuth refresh dedup logic
# is now baked into src/agents/auth-profiles/oauth.ts and ships in the image.
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
INPUT_FILES_BUNDLE=$(docker cp "$EXTRACT_CONTAINER:/app/dist/" - | tar -t 2>/dev/null | grep -oE 'dist/input-files-[A-Za-z0-9_-]+\.js$' | head -1 | xargs basename)

for var in GATEWAY_BUNDLE INPUT_FILES_BUNDLE; do
  if [[ -z "${!var}" ]]; then
    echo "ERROR: Could not discover $var in $IMAGE_TAG:/app/dist/"
    exit 1
  fi
done

echo "    gateway-cli:   $GATEWAY_BUNDLE"
echo "    input-files:   $INPUT_FILES_BUNDLE"
echo "    auth-profiles: (removed — now Layer A in src/agents/auth-profiles/oauth.ts)"

# ─── Step 2: Remove any stale patched bundles from previous rebuilds ──────
echo ""
echo "==> Cleaning stale patched bundles..."
shopt -s nullglob
for pattern in 'gateway-cli-*.js' 'input-files-*.js' 'auth-profiles-*.js'; do
  for old in $pattern; do
    # Keep the one we're about to regenerate
    case "$old" in
      "$GATEWAY_BUNDLE"|"$INPUT_FILES_BUNDLE") continue ;;
    esac
    # Also keep .bak and .unpatched variants in case user wants them for debugging
    case "$old" in
      *.bak|*.unpatched) continue ;;
    esac
    echo "    rm $old"
    rm -f "$old"
  done
done
shopt -u nullglob

# ─── Step 3: Extract fresh unpatched bundles ──────────────────────────────
echo ""
echo "==> Extracting fresh unpatched bundles..."
for bundle in "$GATEWAY_BUNDLE" "$INPUT_FILES_BUNDLE"; do
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

# ─── Step 5: Patch input-files (binary passthrough) ──────────────────────
echo ""
echo "==> Patching $INPUT_FILES_BUNDLE..."
node - "$INPUT_FILES_BUNDLE" <<'PATCH_INPUT_FILES'
const fs = require("node:fs");
const file = process.argv[2];
let src = fs.readFileSync(file, "utf8");

if (src.includes("binaryPassthroughMimes")) {
  console.log("    already patched (binaryPassthroughMimes present), skipping");
  process.exit(0);
}

// Anchor: the line that throws on unsupported MIME type. The patched block
// goes between this check and the PDF extraction block that follows it.
const anchor = /(if \(!limits\.allowedMimes\.has\(mimeType\)\) throw new Error\(`Unsupported file MIME type: \$\{mimeType\}`\);)\n(\s*)(if \(mimeType === "application\/pdf"\))/;

if (!anchor.test(src)) {
  console.error("    FAIL: could not locate input-files anchor pattern");
  console.error("    The bundle structure may have changed upstream — manual port required");
  process.exit(2);
}

const insertion = `
		// Binary passthrough: return raw base64 for non-text file types
		const binaryPassthroughMimes = new Set([
			"application/zip", "application/x-zip-compressed", "application/gzip", "application/x-gzip",
			"application/x-tar", "application/x-bzip2", "application/x-7z-compressed", "application/vnd.rar",
			"application/octet-stream",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
			"application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
			"application/epub+zip", "application/wasm", "application/parquet"
		]);
		const isBinary = binaryPassthroughMimes.has(mimeType)
			|| (mimeType.startsWith("application/") && !mimeType.startsWith("application/json") && !mimeType.startsWith("application/xml") && !mimeType.startsWith("application/sql") && !mimeType.startsWith("application/graphql"));
		if (isBinary) {
			return {
				filename,
				rawBase64: buffer.toString("base64"),
				rawMimeType: mimeType
			};
		}
`;

src = src.replace(anchor, (_m, p1, indent, p3) => `${p1}\n${insertion}${indent}${p3}`);
fs.writeFileSync(file, src);
console.log("    OK: binaryPassthroughMimes block inserted");
PATCH_INPUT_FILES

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
  sed -i '' -E "s#(openclaw/|/app/dist/)input-files-[A-Za-z0-9_-]+\.js#\1${INPUT_FILES_BUNDLE}#g" "$COMPOSE_OVERRIDE"

  echo "    OK: mount paths updated (backup at ${COMPOSE_OVERRIDE}.bak-*)"
fi

# ─── Step 7: Final summary ──────────────────────────────────────────────
echo ""
echo "==> Done. Patched bundles ready:"
echo "    ${GATEWAY_BUNDLE}     (gateway-cli: payload + chat history limits)"
echo "    ${INPUT_FILES_BUNDLE} (input-files: binary passthrough)"
echo "    (auth-profiles OAuth dedup is now Layer A — baked into the image)"
echo ""
echo "Next:"
echo "    docker compose down"
echo "    docker compose up -d openclaw-gateway"
echo "    # Verify Layer B patches in running container:"
echo "    docker compose exec openclaw-gateway grep -c binaryPassthroughMimes /app/dist/${INPUT_FILES_BUNDLE}"
echo "    docker compose exec openclaw-gateway grep -c '1024 \\* 1024 \\* 1024' /app/dist/${GATEWAY_BUNDLE}"
echo "    docker compose exec openclaw-gateway grep -c '500 \\* 1024 \\* 1024' /app/dist/${GATEWAY_BUNDLE}"
echo "    # Verify Layer A OAuth dedup (in any of the gateway chunks):"
echo "    docker compose exec openclaw-gateway sh -c 'grep -lc pendingOAuthRefreshes /app/dist/*.js | head'"
