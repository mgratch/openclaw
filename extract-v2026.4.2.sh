#!/bin/bash
# Extract the files I need to patch for v2026.4.2
set -euo pipefail
cd "$(dirname "$0")"
CONTAINER="openclaw-gateway"
PI_AI_PATH="/app/node_modules/.pnpm/@mariozechner+pi-ai@0.64.0_@modelcontextprotocol+sdk@1.29.0_zod@4.3.6__ws@8.20.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/providers"

echo "==> Extracting input-files-BT2Wb53r.js..."
docker compose cp "${CONTAINER}:/app/dist/input-files-BT2Wb53r.js" ./input-files-BT2Wb53r.js
cp input-files-BT2Wb53r.js input-files-BT2Wb53r.js.orig

echo "==> Extracting pi-ai providers..."
mkdir -p pi-ai-providers
for f in anthropic.js openai-completions.js openai-responses-shared.js google-shared.js; do
  docker compose cp "${CONTAINER}:${PI_AI_PATH}/$f" "./pi-ai-providers/${f}"
  cp "./pi-ai-providers/${f}" "./pi-ai-providers/${f}.v0.64.0.orig"
  echo "    ✓ $f"
done

echo "$PI_AI_PATH" > .pi-ai-store-path
echo "input-files-BT2Wb53r.js" > .input-files-bundle-name

echo ""
echo "Done. Files ready for patching."
