#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# OpenClaw Projects — Phase 1 Setup
# Creates multi-agent workspace structure and gateway config.
#
# Usage:
#   chmod +x setup-projects.sh
#   ./setup-projects.sh              # Full setup (dry-run first)
#   ./setup-projects.sh --execute    # Actually create everything
#   ./setup-projects.sh --verify     # Check existing setup
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
OPENCLAW_INSTALL="${OPENCLAW_INSTALL:-/Users/marcgratch/openclaw}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:---dry-run}"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ─── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; }
dry()   { echo -e "${YELLOW}[DRY]${NC}   Would: $1"; }

# ─── Project Definitions ────────────────────────────────────
# Add/remove projects here. Format: id|name|description|model|mount_path
PROJECTS=(
  "main|Personal|General assistant — personal tasks, OpenClaw development|anthropic/claude-opus-4-6|"
  "kirkwood|Kirkwood Collection|WordPress multisite, hotel group. Custom plugins, DB migrations, performance.|anthropic/claude-sonnet-4-5|$HOME/Sites/kirkwood"
  "security|Security Audit|Security audits across multiple repos. Lidar Engineering / Nighthawk Pro.|anthropic/claude-opus-4-6|"
)

# ─── Verify Mode ─────────────────────────────────────────────
if [[ "$MODE" == "--verify" ]]; then
  echo -e "\n${BLUE}═══ OpenClaw Projects — Verification ═══${NC}\n"
  PASS=0; FAIL=0

  check() {
    if eval "$2"; then ok "$1"; ((PASS++)); else err "$1"; ((FAIL++)); fi
  }

  check "openclaw.json exists" "[ -f '$OPENCLAW_DIR/openclaw.json' ]"
  check "openclaw.json has agents.list" "grep -q '\"list\"' '$OPENCLAW_DIR/openclaw.json' 2>/dev/null"
  check "Shared skills directory exists" "[ -d '$OPENCLAW_DIR/skills' ]"

  for proj in "${PROJECTS[@]}"; do
    IFS='|' read -r id name desc model mount <<< "$proj"
    ws="$OPENCLAW_DIR/workspace"
    [[ "$id" != "main" ]] && ws="$OPENCLAW_DIR/workspace-$id"

    check "Workspace [$id] directory exists" "[ -d '$ws' ]"
    check "Workspace [$id] AGENTS.md exists" "[ -f '$ws/AGENTS.md' ]"
    check "Workspace [$id] MEMORY.md exists" "[ -f '$ws/MEMORY.md' ]"
    check "Workspace [$id] knowledge/ exists" "[ -d '$ws/knowledge' ]"
    check "Workspace [$id] skills/ exists" "[ -d '$ws/skills' ]"

    if [[ -n "$mount" && "$mount" != "" ]]; then
      check "Workspace [$id] project symlink exists" "[ -L '$ws/project' ] || [ -d '$ws/project' ]"
    fi

    check "Agent dir [$id] exists" "[ -d '$OPENCLAW_DIR/agents/$id' ]"
  done

  # Check hot-reload watcher
  check "Config watcher script exists" "[ -f '$OPENCLAW_DIR/config-watcher.sh' ]"

  # Check docker-compose.override.yml
  check "docker-compose.override.yml exists" "[ -f '$OPENCLAW_INSTALL/docker-compose.override.yml' ]"
  check "docker-compose has kirkwood volume" "grep -q 'workspace-kirkwood' '$OPENCLAW_INSTALL/docker-compose.override.yml' 2>/dev/null"
  check "docker-compose has security volume" "grep -q 'workspace-security' '$OPENCLAW_INSTALL/docker-compose.override.yml' 2>/dev/null"

  echo -e "\n${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}\n"
  exit 0
fi

# ─── Dry-Run / Execute ──────────────────────────────────────
if [[ "$MODE" != "--execute" ]]; then
  echo -e "\n${YELLOW}═══ DRY RUN — no changes will be made ═══${NC}"
  echo -e "Run with ${GREEN}--execute${NC} to apply changes.\n"
fi

do_cmd() {
  if [[ "$MODE" == "--execute" ]]; then
    eval "$1"
  else
    dry "$1"
  fi
}

# ─── Step 1: Backup existing config ─────────────────────────
info "Step 1: Backing up existing openclaw.json"
if [[ -f "$OPENCLAW_DIR/openclaw.json" ]]; then
  do_cmd "cp '$OPENCLAW_DIR/openclaw.json' '$OPENCLAW_DIR/openclaw.json.bak-$(date +%Y%m%d-%H%M%S)'"
  ok "Backed up openclaw.json"
else
  warn "No existing openclaw.json found"
fi

# ─── Step 2: Create shared directories ──────────────────────
info "Step 2: Creating shared directories"
do_cmd "mkdir -p '$OPENCLAW_DIR/skills'"
ok "Shared skills directory: $OPENCLAW_DIR/skills/"

# ─── Step 3: Create workspace directories ───────────────────
info "Step 3: Creating project workspace directories"
for proj in "${PROJECTS[@]}"; do
  IFS='|' read -r id name desc model mount <<< "$proj"

  # Determine workspace path
  if [[ "$id" == "main" ]]; then
    WS="$OPENCLAW_DIR/workspace"
  else
    WS="$OPENCLAW_DIR/workspace-$id"
  fi

  info "  Project: $name ($id) → $WS"

  do_cmd "mkdir -p '$WS/knowledge'"
  do_cmd "mkdir -p '$WS/skills'"

  # AGENTS.md — only create if it doesn't exist (preserve existing)
  if [[ ! -f "$WS/AGENTS.md" ]] || [[ "$id" != "main" && "$MODE" == "--execute" && ! -f "$WS/AGENTS.md" ]]; then
    if [[ "$MODE" == "--execute" ]]; then
      cat > "$WS/AGENTS.md" << AGENTSEOF
# ${name} — Agent Instructions

## Role
${desc}

## Knowledge Files
Check the \`knowledge/\` directory for project-specific documents.
Read files on demand with the \`read\` tool when you need detailed content.

## Available Knowledge
<!-- Updated automatically or manually when files are added to knowledge/ -->
_No knowledge files yet._

## Guidelines
- Stay focused on this project's domain
- Reference knowledge files when answering domain-specific questions
- Store important decisions and context in MEMORY.md
AGENTSEOF
      ok "  Created AGENTS.md"
    else
      dry "Create $WS/AGENTS.md"
    fi
  else
    ok "  AGENTS.md already exists — skipping"
  fi

  # SOUL.md — symlink to main for non-main projects, or create if main
  if [[ "$id" != "main" ]]; then
    if [[ ! -f "$WS/SOUL.md" ]]; then
      if [[ -f "$OPENCLAW_DIR/workspace/SOUL.md" ]]; then
        do_cmd "ln -sf '$OPENCLAW_DIR/workspace/SOUL.md' '$WS/SOUL.md'"
        ok "  Symlinked SOUL.md → main workspace"
      else
        warn "  Main workspace SOUL.md not found — creating standalone"
        if [[ "$MODE" == "--execute" ]]; then
          echo "# Soul — ${name}" > "$WS/SOUL.md"
          echo "Inherits personality from main agent." >> "$WS/SOUL.md"
        fi
      fi
    else
      ok "  SOUL.md already exists — skipping"
    fi
  fi

  # USER.md — symlink to main for non-main projects
  if [[ "$id" != "main" ]]; then
    if [[ ! -f "$WS/USER.md" ]]; then
      if [[ -f "$OPENCLAW_DIR/workspace/USER.md" ]]; then
        do_cmd "ln -sf '$OPENCLAW_DIR/workspace/USER.md' '$WS/USER.md'"
        ok "  Symlinked USER.md → main workspace"
      else
        warn "  Main workspace USER.md not found — skipping symlink"
      fi
    else
      ok "  USER.md already exists — skipping"
    fi
  fi

  # MEMORY.md — always project-specific (never shared)
  if [[ ! -f "$WS/MEMORY.md" ]]; then
    if [[ "$MODE" == "--execute" ]]; then
      cat > "$WS/MEMORY.md" << MEMEOF
# ${name} — Memory

_Project-specific long-term memory. Updated by the agent during conversations._

---
MEMEOF
      ok "  Created MEMORY.md"
    else
      dry "Create $WS/MEMORY.md"
    fi
  else
    ok "  MEMORY.md already exists — skipping"
  fi

  # KNOWLEDGE.md manifest — auto-injected summary of available knowledge
  if [[ ! -f "$WS/KNOWLEDGE.md" ]]; then
    if [[ "$MODE" == "--execute" ]]; then
      cat > "$WS/KNOWLEDGE.md" << KNOWLEDGEEOF
# ${name} — Knowledge Manifest

Files in \`knowledge/\` available via the \`read\` tool:

| File | Size | Description |
|------|------|-------------|
| _none yet_ | — | — |

_This file is auto-injected into the system prompt. Keep it small._
_Add descriptions when you upload files to knowledge/._
KNOWLEDGEEOF
      ok "  Created KNOWLEDGE.md"
    else
      dry "Create $WS/KNOWLEDGE.md"
    fi
  else
    ok "  KNOWLEDGE.md already exists — skipping"
  fi

  # Project mount (symlink to live codebase)
  if [[ -n "$mount" && "$mount" != "" ]]; then
    if [[ ! -L "$WS/project" && ! -d "$WS/project" ]]; then
      if [[ -d "$mount" ]]; then
        do_cmd "ln -sf '$mount' '$WS/project'"
        ok "  Symlinked project/ → $mount"
      else
        warn "  Mount target does not exist: $mount — skipping symlink"
      fi
    else
      ok "  project/ symlink already exists — skipping"
    fi
  fi

  # Agent sessions directory
  do_cmd "mkdir -p '$OPENCLAW_DIR/agents/$id/agent'"
  do_cmd "mkdir -p '$OPENCLAW_DIR/agents/$id/sessions'"
  ok "  Agent directory: $OPENCLAW_DIR/agents/$id/"

  echo ""
done

# ─── Step 4: Generate openclaw.json ─────────────────────────
info "Step 4: Generating multi-agent openclaw.json"

AGENTS_JSON=""
FIRST=true
for proj in "${PROJECTS[@]}"; do
  IFS='|' read -r id name desc model mount <<< "$proj"

  WS="$OPENCLAW_DIR/workspace"
  [[ "$id" != "main" ]] && WS="$OPENCLAW_DIR/workspace-$id"

  DEFAULT_FLAG=""
  [[ "$id" == "main" ]] && DEFAULT_FLAG=',
        "default": true'

  [[ "$FIRST" == "true" ]] || AGENTS_JSON+=","
  FIRST=false

  AGENTS_JSON+="
      {
        \"id\": \"${id}\",
        \"name\": \"${name}\",
        \"description\": \"${desc}\",
        \"workspace\": \"${WS}\",
        \"model\": \"${model}\"${DEFAULT_FLAG},
        \"createdAt\": \"${NOW}\"
      }"
done

# We'll merge this into the existing config rather than overwriting it entirely.
# This script generates the agents section — you'll need to merge it with your
# existing openclaw.json settings (providers, extensions, etc.)
if [[ "$MODE" == "--execute" ]]; then
  # Read existing config to preserve non-agent settings
  AGENTS_SECTION="{
  \"agents\": {
    \"list\": [${AGENTS_JSON}
    ]
  },
  \"bindings\": [
    { \"agentId\": \"main\", \"match\": { \"channel\": \"slack\" } }
  ]
}"

  # Write the agents section to a separate file for safe merging
  echo "$AGENTS_SECTION" > "$OPENCLAW_DIR/agents-config.json"
  ok "Wrote agents config to $OPENCLAW_DIR/agents-config.json"
  echo ""
  info "IMPORTANT: Merge agents-config.json into your openclaw.json manually."
  info "This preserves your existing provider keys, extensions, and other settings."
  info "The agents section replaces/adds to the 'agents' and 'bindings' keys."
else
  dry "Generate agents-config.json with ${#PROJECTS[@]} agents"
fi

# ─── Step 5: Hot-Reload Watcher ─────────────────────────────
info "Step 5: Creating config hot-reload watcher"

if [[ "$MODE" == "--execute" ]]; then
  cat > "$OPENCLAW_DIR/config-watcher.sh" << 'WATCHEREOF'
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# OpenClaw Config Watcher — Hot-reload without full restart
#
# Watches openclaw.json for changes and sends SIGHUP to the
# gateway container to trigger a config reload. Falls back to
# a graceful container restart if SIGHUP isn't supported.
#
# Usage:
#   ./config-watcher.sh                    # Run in foreground
#   ./config-watcher.sh --daemon           # Run in background
#   ./config-watcher.sh --stop             # Stop background watcher
#
# Requires: inotifywait (inotify-tools) or fswatch (macOS)
# Install:
#   Linux:  sudo apt install inotify-tools
#   macOS:  brew install fswatch
# ─────────────────────────────────────────────────────────────

set -euo pipefail

OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
CONFIG_FILE="$OPENCLAW_DIR/openclaw.json"
PID_FILE="$OPENCLAW_DIR/.config-watcher.pid"
LOG_FILE="$OPENCLAW_DIR/.config-watcher.log"
CONTAINER_NAME="${OPENCLAW_CONTAINER:-openclaw-openclaw-gateway-1}"
DEBOUNCE_SECONDS=2

# ─── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log() { echo -e "[$(date +%H:%M:%S)] $1" | tee -a "$LOG_FILE"; }

# ─── Stop mode ───────────────────────────────────────────────
if [[ "${1:-}" == "--stop" ]]; then
  if [[ -f "$PID_FILE" ]]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      rm -f "$PID_FILE"
      echo -e "${GREEN}Stopped config watcher (PID $PID)${NC}"
    else
      rm -f "$PID_FILE"
      echo -e "${YELLOW}Watcher was not running (stale PID file removed)${NC}"
    fi
  else
    echo -e "${YELLOW}No watcher running${NC}"
  fi
  exit 0
fi

# ─── Reload function ────────────────────────────────────────
reload_gateway() {
  log "${BLUE}Config change detected — reloading gateway...${NC}"

  # Validate JSON before reloading
  if ! python3 -c "import json; json.load(open('$CONFIG_FILE'))" 2>/dev/null && \
     ! node -e "JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8'))" 2>/dev/null; then
    log "${RED}Invalid JSON in openclaw.json — skipping reload${NC}"
    return 1
  fi

  # Strategy 1: Try SIGHUP (graceful config reload)
  if docker exec "$CONTAINER_NAME" kill -HUP 1 2>/dev/null; then
    log "${GREEN}Sent SIGHUP to gateway — config reloaded${NC}"
    return 0
  fi

  # Strategy 2: Try the admin API endpoint (if available)
  if curl -sf http://127.0.0.1:18789/admin/reload 2>/dev/null; then
    log "${GREEN}Reloaded via admin API${NC}"
    return 0
  fi

  # Strategy 3: Graceful container restart (last resort)
  log "${YELLOW}SIGHUP not supported — performing graceful restart...${NC}"
  OPENCLAW_INSTALL="${OPENCLAW_INSTALL:-/Users/marcgratch/openclaw}"
  if (cd "$OPENCLAW_INSTALL" && docker compose restart openclaw-gateway 2>/dev/null) || \
     (cd "$OPENCLAW_INSTALL" && docker-compose restart openclaw-gateway 2>/dev/null); then
    log "${GREEN}Gateway restarted successfully${NC}"
    # Wait for gateway to be healthy
    for i in $(seq 1 30); do
      if docker exec "$CONTAINER_NAME" true 2>/dev/null; then
        log "${GREEN}Gateway is healthy after restart${NC}"
        return 0
      fi
      sleep 1
    done
    log "${YELLOW}Gateway restart timed out — check manually${NC}"
    return 1
  else
    log "${RED}Failed to restart gateway${NC}"
    return 1
  fi
}

# ─── Watch function ──────────────────────────────────────────
watch_config() {
  log "${GREEN}Watching $CONFIG_FILE for changes...${NC}"
  log "Container: $CONTAINER_NAME"
  log "Debounce: ${DEBOUNCE_SECONDS}s"

  LAST_RELOAD=0

  if command -v inotifywait &>/dev/null; then
    # Linux: inotifywait
    while true; do
      inotifywait -q -e modify,create,moved_to "$CONFIG_FILE" 2>/dev/null || true
      NOW=$(date +%s)
      if (( NOW - LAST_RELOAD >= DEBOUNCE_SECONDS )); then
        LAST_RELOAD=$NOW
        reload_gateway || true
      fi
    done
  elif command -v fswatch &>/dev/null; then
    # macOS: fswatch
    fswatch -o "$CONFIG_FILE" | while read -r _; do
      NOW=$(date +%s)
      if (( NOW - LAST_RELOAD >= DEBOUNCE_SECONDS )); then
        LAST_RELOAD=$NOW
        reload_gateway || true
      fi
    done
  else
    # Fallback: polling
    log "${YELLOW}No inotifywait or fswatch found — falling back to polling (5s)${NC}"
    LAST_HASH=""
    while true; do
      HASH=$(md5sum "$CONFIG_FILE" 2>/dev/null | cut -d' ' -f1 || md5 -q "$CONFIG_FILE" 2>/dev/null || echo "")
      if [[ -n "$LAST_HASH" && "$HASH" != "$LAST_HASH" ]]; then
        NOW=$(date +%s)
        if (( NOW - LAST_RELOAD >= DEBOUNCE_SECONDS )); then
          LAST_RELOAD=$NOW
          reload_gateway || true
        fi
      fi
      LAST_HASH="$HASH"
      sleep 5
    done
  fi
}

# ─── Daemon mode ─────────────────────────────────────────────
if [[ "${1:-}" == "--daemon" ]]; then
  if [[ -f "$PID_FILE" ]]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
      echo -e "${YELLOW}Watcher already running (PID $OLD_PID)${NC}"
      exit 0
    fi
  fi
  nohup "$0" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo -e "${GREEN}Config watcher started (PID $!)${NC}"
  echo -e "Log: $LOG_FILE"
  echo -e "Stop: $0 --stop"
  exit 0
fi

# ─── Foreground mode ────────────────────────────────────────
watch_config
WATCHEREOF
  chmod +x "$OPENCLAW_DIR/config-watcher.sh"
  ok "Created config watcher: $OPENCLAW_DIR/config-watcher.sh"
else
  dry "Create config-watcher.sh"
fi

# ─── Step 6: Update docker-compose.override.yml ─────────────
info "Step 6: Updating docker-compose.override.yml"

COMPOSE_OVERRIDE="$OPENCLAW_INSTALL/docker-compose.override.yml"

# The volume entries we need
REQUIRED_VOLUMES=(
  "~/.openclaw/workspace-kirkwood:/workspace-kirkwood"
  "~/.openclaw/workspace-security:/workspace-security"
  "~/Sites:/mnt/sites:ro"
  "~/.openclaw/skills:/skills:ro"
)

if [[ "$MODE" == "--execute" ]]; then
  if [[ -f "$COMPOSE_OVERRIDE" ]]; then
    # Backup existing
    cp "$COMPOSE_OVERRIDE" "${COMPOSE_OVERRIDE}.bak-$(date +%Y%m%d-%H%M%S)"
    ok "Backed up existing docker-compose.override.yml"

    # Check which volumes are already present
    MISSING_VOLUMES=()
    for vol in "${REQUIRED_VOLUMES[@]}"; do
      # Match on the host:container portion (ignore trailing :ro/:rw for matching)
      VOL_HOST=$(echo "$vol" | cut -d: -f1)
      VOL_CONTAINER=$(echo "$vol" | cut -d: -f2)
      if grep -qF "$VOL_CONTAINER" "$COMPOSE_OVERRIDE" 2>/dev/null; then
        ok "  Volume already present: $vol"
      else
        MISSING_VOLUMES+=("$vol")
      fi
    done

    if [[ ${#MISSING_VOLUMES[@]} -eq 0 ]]; then
      ok "All required volumes already in docker-compose.override.yml"
    else
      # Strategy: find the volumes: section under gateway and append
      # We use python3 + PyYAML if available, otherwise sed-based insertion

      if python3 -c "import yaml" 2>/dev/null; then
        # ── Python/YAML approach (safe, preserves structure) ──
        python3 << PYEOF
import yaml, sys, copy

with open("$COMPOSE_OVERRIDE", "r") as f:
    doc = yaml.safe_load(f) or {}

# Ensure structure exists
if "services" not in doc:
    doc["services"] = {}
if "gateway" not in doc["services"]:
    doc["services"]["gateway"] = {}
if "volumes" not in doc["services"]["gateway"]:
    doc["services"]["gateway"]["volumes"] = []

existing = doc["services"]["gateway"]["volumes"]
missing = $(python3 -c "import json; print(json.dumps([v for v in [$(printf '"%s",' "${MISSING_VOLUMES[@]}")] if v]))")

for vol in missing:
    # Check if container path already exists
    container_path = vol.split(":")[1] if ":" in vol else vol
    already = any(container_path in str(e) for e in existing)
    if not already:
        existing.append(vol)
        print(f"  Added: {vol}")

with open("$COMPOSE_OVERRIDE", "w") as f:
    yaml.dump(doc, f, default_flow_style=False, sort_keys=False)

print("  ✅ docker-compose.override.yml updated")
PYEOF
      else
        # ── Sed fallback (less safe but works without PyYAML) ──
        warn "PyYAML not available — using sed-based insertion"

        # Find last volume line under gateway and insert after it
        for vol in "${MISSING_VOLUMES[@]}"; do
          # If there's a volumes: section under services.gateway, append to it
          if grep -q "volumes:" "$COMPOSE_OVERRIDE"; then
            # Find the last line that starts with "      - " (volume entry) and insert after
            LAST_VOL_LINE=$(grep -n "^      - " "$COMPOSE_OVERRIDE" | tail -1 | cut -d: -f1)
            if [[ -n "$LAST_VOL_LINE" ]]; then
              sed -i.tmp "${LAST_VOL_LINE}a\\
      - ${vol}" "$COMPOSE_OVERRIDE"
              rm -f "${COMPOSE_OVERRIDE}.tmp"
              ok "  Added volume: $vol"
            else
              warn "  Could not find volume insertion point for: $vol"
              warn "  Add manually: - ${vol}"
            fi
          else
            # No volumes section exists — append entire block
            cat >> "$COMPOSE_OVERRIDE" << VOLEOF

    volumes:
      - ${vol}
VOLEOF
            ok "  Created volumes section with: $vol"
          fi
        done
      fi
    fi
  else
    # No override file exists — create from scratch
    info "Creating new docker-compose.override.yml at $COMPOSE_OVERRIDE"
    cat > "$COMPOSE_OVERRIDE" << 'COMPOSEEOF'
# ─────────────────────────────────────────────────────────────
# docker-compose.override.yml — OpenClaw Projects
# Auto-generated by setup-projects.sh
# ─────────────────────────────────────────────────────────────

services:
  gateway:
    volumes:
      # Project workspaces
      - ~/.openclaw/workspace-kirkwood:/workspace-kirkwood
      - ~/.openclaw/workspace-security:/workspace-security

      # Live code access (read-only — change to :rw for agent write access)
      - ~/Sites:/mnt/sites:ro

      # Shared skills
      - ~/.openclaw/skills:/skills:ro
COMPOSEEOF
    ok "Created docker-compose.override.yml"
  fi
else
  if [[ -f "$COMPOSE_OVERRIDE" ]]; then
    info "Would update existing $COMPOSE_OVERRIDE"
    for vol in "${REQUIRED_VOLUMES[@]}"; do
      VOL_CONTAINER=$(echo "$vol" | cut -d: -f2)
      if grep -qF "$VOL_CONTAINER" "$COMPOSE_OVERRIDE" 2>/dev/null; then
        dry "  Volume already present: $vol"
      else
        dry "  Add volume: $vol"
      fi
    done
  else
    dry "Create $COMPOSE_OVERRIDE with ${#REQUIRED_VOLUMES[@]} volume mounts"
  fi
fi

# ─── Summary ─────────────────────────────────────────────────
echo ""
echo -e "${BLUE}═══ Phase 1 Setup Summary ═══${NC}"
echo ""
echo "Projects configured: ${#PROJECTS[@]}"
for proj in "${PROJECTS[@]}"; do
  IFS='|' read -r id name desc model mount <<< "$proj"
  echo -e "  ${GREEN}●${NC} $name ($id) — $model"
done
echo ""
echo "Next steps:"
echo "  1. Run with --execute to create directories and update docker-compose"
echo "  2. Merge agents-config.json into your openclaw.json"
echo "  3. Restart gateway: cd $OPENCLAW_INSTALL && docker compose restart openclaw-gateway"
echo "  4. Start config watcher: ~/.openclaw/config-watcher.sh --daemon"
echo "  5. Run with --verify to check everything"
echo "  6. Test routing: create a session targeting each agent"
echo ""
echo -e "${YELLOW}Hardcoded agent:main references in the UI (fix in Phase 2):${NC}"
echo "  - src/hooks/useChatActions.ts  → x-openclaw-session-key header"
echo "  - src/hooks/useChatActions.ts  → model: 'openclaw:main'"
echo "  - src/hooks/useSessionActions.ts → agent:main in fullKey for AI naming"
echo ""
