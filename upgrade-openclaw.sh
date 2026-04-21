#!/bin/bash
# upgrade-openclaw.sh — Full upgrade with patch preservation
#
# Updates OpenClaw to the latest tagged release while retaining all
# local customizations (Dockerfile.custom, docker-compose.override.yml,
# openclaw.json, patched gateway bundles).
#
# Usage:
#   ./upgrade-openclaw.sh              # Show what would happen (dry run)
#   ./upgrade-openclaw.sh --execute    # Actually do the upgrade
#   ./upgrade-openclaw.sh --execute --tag v2026.2.23  # Pin to specific tag

set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:---dry-run}"
TAG=""

# Parse args
for arg in "$@"; do
  case "$arg" in
    --execute) MODE="--execute" ;;
    --tag) ;; # next arg is the tag
    v*) TAG="$arg" ;;
  esac
done

# ─── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()   { echo -e "${RED}[ERR]${NC}   $1"; }

# ─── Pre-flight checks ──────────────────────────────────────────
info "Pre-flight checks..."

[[ -f "docker-compose.yml" ]] || { err "Not in OpenClaw repo directory. Run from ~/openclaw/"; exit 1; }
[[ -f "Dockerfile.custom" ]] || { err "Dockerfile.custom not found"; exit 1; }
[[ -f "docker-compose.override.yml" ]] || { err "docker-compose.override.yml not found"; exit 1; }

CURRENT_VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "unknown")
CURRENT_COMMIT=$(git rev-parse --short HEAD)
info "Current: $CURRENT_VERSION ($CURRENT_COMMIT)"

# ─── Step 1: Fetch latest ───────────────────────────────────────
info "Step 1: Fetching latest from origin..."
if [[ "$MODE" == "--execute" ]]; then
  git fetch origin --tags
else
  info "  [dry-run] Would fetch origin"
fi

# Determine target tag
if [[ -z "$TAG" ]]; then
  TAG=$(git tag --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
fi
info "Target: $TAG"

if [[ "$TAG" == "$CURRENT_VERSION" ]]; then
  ok "Already on latest release ($TAG)"
  echo ""
  info "To re-apply patches on current version, run: ./patch-gateway-bundles.sh"
  exit 0
fi

# Show what changed
COMMITS_BEHIND=$(git log --oneline "$CURRENT_COMMIT".."$TAG" 2>/dev/null | wc -l | tr -d ' ')
info "Commits to pull: $COMMITS_BEHIND"

# ─── Step 2: Pull to target tag ─────────────────────────────────
info "Step 2: Updating to $TAG..."
if [[ "$MODE" == "--execute" ]]; then
  # Stash any tracked changes (shouldn't be any since our files are untracked)
  git checkout main
  git pull origin main
  ok "Pulled latest main"
else
  info "  [dry-run] Would pull origin/main"
fi

# ─── Step 3: Stop containers ────────────────────────────────────
info "Step 3: Stopping containers..."
if [[ "$MODE" == "--execute" ]]; then
  docker compose down
  ok "Containers stopped"
else
  info "  [dry-run] Would stop containers"
fi

# ─── Step 4: Build base image ───────────────────────────────────
info "Step 4: Building base image (openclaw:local)..."
if [[ "$MODE" == "--execute" ]]; then
  docker build -t openclaw:local -f Dockerfile .
  ok "Base image built"
else
  info "  [dry-run] Would build openclaw:local from Dockerfile"
fi

# ─── Step 5: Build custom image ─────────────────────────────────
info "Step 5: Building custom image (openclaw:custom)..."
if [[ "$MODE" == "--execute" ]]; then
  docker compose build openclaw-gateway
  ok "Custom image built"
else
  info "  [dry-run] Would build openclaw:custom from Dockerfile.custom"
fi

# ─── Step 6: Start containers (briefly, to discover bundles) ────
info "Step 6: Starting containers to discover new bundle filenames..."
if [[ "$MODE" == "--execute" ]]; then
  # Temporarily remove bundle mounts so the container starts clean
  # (old bundle filenames won't exist in new image)
  OVERRIDE_BAK="docker-compose.override.yml.pre-upgrade-$(date +%Y%m%d-%H%M%S)"
  cp docker-compose.override.yml "$OVERRIDE_BAK"

  # Comment out old bundle mounts
  sed -i '' 's|^\(      - .*gateway-cli-.*\.js:/app/dist/\)|      # UPGRADING: \1|' docker-compose.override.yml

  docker compose up -d openclaw-gateway
  echo "    Waiting for container to start..."
  sleep 5
  ok "Container started"
else
  info "  [dry-run] Would start container without bundle mounts"
fi

# ─── Step 7: Patch bundles ──────────────────────────────────────
info "Step 7: Patching gateway bundles..."
if [[ "$MODE" == "--execute" ]]; then
  # Restore the original override (patch script will update it)
  cp "$OVERRIDE_BAK" docker-compose.override.yml

  # Run the patch script
  bash patch-gateway-bundles.sh
  ok "Bundles patched"
else
  info "  [dry-run] Would run patch-gateway-bundles.sh"
  info "  This discovers new bundle filenames, patches MAX_PAYLOAD_BYTES (→1GB)"
  info "  and DEFAULT_MAX_CHAT_HISTORY_MESSAGES_BYTES (→500MB),"
  info "  then updates docker-compose.override.yml with new mount paths"
fi

# ─── Step 8: Restart with patched bundles ────────────────────────
info "Step 8: Restarting with patched bundles..."
if [[ "$MODE" == "--execute" ]]; then
  docker compose down
  docker compose up -d
  ok "Containers restarted with patches"
else
  info "  [dry-run] Would restart containers"
fi

# ─── Step 9: Verify ─────────────────────────────────────────────
info "Step 9: Verifying..."
if [[ "$MODE" == "--execute" ]]; then
  sleep 5

  # Check version
  NEW_VERSION=$(docker exec openclaw-openclaw-gateway-1 node -e "try{console.log(require('/app/package.json').version)}catch(e){console.log('unknown')}" 2>/dev/null || echo "unknown")
  info "  Container version: $NEW_VERSION"

  # Check patches
  echo ""
  info "  Checking patches..."
  docker exec openclaw-openclaw-gateway-1 grep -h 'const MAX_PAYLOAD_BYTES\|const DEFAULT_MAX_CHAT_HISTORY' /app/dist/gateway-cli-*.js 2>/dev/null | sort -u || warn "Could not verify patches"

  # Check Slack
  echo ""
  info "  Checking Slack provider (wait 10s for startup)..."
  sleep 10
  SLACK_STATUS=$(docker logs openclaw-openclaw-gateway-1 2>&1 | grep -i 'slack' | tail -3)
  echo "$SLACK_STATUS"

  if echo "$SLACK_STATUS" | grep -q "channel exited\|error\|fail"; then
    warn "Slack may have issues — check logs with: docker logs openclaw-openclaw-gateway-1 2>&1 | grep slack"
  fi

  echo ""
  ok "Upgrade complete: $CURRENT_VERSION → $NEW_VERSION"
else
  echo ""
  info "═══ Dry Run Summary ═══"
  echo ""
  info "  From: $CURRENT_VERSION ($CURRENT_COMMIT)"
  info "  To:   $TAG ($COMMITS_BEHIND commits)"
  echo ""
  info "  What will happen:"
  info "    1. git pull to $TAG"
  info "    2. docker compose down"
  info "    3. Build openclaw:local (base image)"
  info "    4. Build openclaw:custom (Dockerfile.custom on top)"
  info "    5. Start container, discover new bundle filenames"
  info "    6. Patch bundles (MAX_PAYLOAD→1GB, HISTORY→500MB)"
  info "    7. Update docker-compose.override.yml with new filenames"
  info "    8. Restart with patches applied"
  echo ""
  info "  Preserved:"
  info "    ✓ Dockerfile.custom (custom packages)"
  info "    ✓ docker-compose.override.yml (ports, mounts, chrome sidecar)"
  info "    ✓ openclaw.json (all config)"
  info "    ✓ Workspace data (~/.openclaw/)"
  info "    ✓ Session data"
  echo ""
  info "  Run with --execute to proceed."
fi
