#!/bin/bash
# Diagnostic: find where extractFileContentFromSource lives in v2026.4.2
CONTAINER="openclaw-gateway"

echo "==> Searching for extractFileContentFromSource in /app/dist/..."
docker exec "$CONTAINER" grep -rl 'extractFileContentFromSource' /app/dist/ 2>/dev/null || echo "(not found in dist)"

echo ""
echo "==> Searching for extractFileContent in /app/dist/..."
docker exec "$CONTAINER" grep -rl 'extractFileContent' /app/dist/ 2>/dev/null || echo "(not found in dist)"

echo ""
echo "==> Searching for binaryPassthrough in /app/dist/..."
docker exec "$CONTAINER" grep -rl 'binaryPassthrough' /app/dist/ 2>/dev/null || echo "(not found)"

echo ""
echo "==> Searching for extractFileContentFromSource in /app/..."
docker exec "$CONTAINER" grep -rl 'extractFileContentFromSource' /app/dist/ /app/node_modules/.pnpm/ 2>/dev/null | head -10 || echo "(not found)"

echo ""
echo "==> Searching for input-files or inputFiles in dist..."
docker exec "$CONTAINER" grep -rl 'input-files\|inputFiles\|InputFile' /app/dist/ 2>/dev/null | head -10 || echo "(not found)"

echo ""
echo "==> Searching for rawBase64 in dist..."
docker exec "$CONTAINER" grep -rl 'rawBase64' /app/dist/ 2>/dev/null | head -10 || echo "(not found)"

echo ""
echo "==> List all reply-*.js files with sizes..."
docker exec "$CONTAINER" ls -lhS /app/dist/reply-*.js 2>/dev/null || echo "(no reply files)"

echo ""
echo "==> Searching media-related files..."
docker exec "$CONTAINER" find /app/dist -name 'media*' -o -name 'input*' 2>/dev/null | head -10 || echo "(none)"

echo ""
echo "==> Search for 'mimeType' + 'base64' in the largest reply files..."
LARGEST=$(docker exec "$CONTAINER" ls -S /app/dist/reply-*.js 2>/dev/null | head -3)
for f in $LARGEST; do
  BASENAME=$(basename "$f")
  HAS=$(docker exec "$CONTAINER" grep -c 'mimeType' "$f" 2>/dev/null || echo "0")
  echo "    $BASENAME: $HAS occurrences of mimeType"
done

echo ""
echo "==> Pi-AI provider path..."
docker exec "$CONTAINER" find /app/node_modules/.pnpm -path '*pi-ai*/dist/providers' -type d 2>/dev/null | head -3 || echo "(not found in .pnpm)"
docker exec "$CONTAINER" find /app/node_modules -maxdepth 5 -path '*pi-ai*/dist/providers' -type d 2>/dev/null | head -3 || echo "(not found in node_modules)"
