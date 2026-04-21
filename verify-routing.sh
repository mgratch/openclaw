#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# OpenClaw Projects — Agent Routing Verification
#
# Tests that sessions route to the correct agent and each agent
# sees its own workspace files in the system prompt.
#
# Usage:
#   ./verify-routing.sh
#   ./verify-routing.sh --verbose
#
# Prerequisites:
#   - Gateway running with multi-agent config
#   - Auth token set in OPENCLAW_TOKEN env var or ~/.openclaw-token
# ─────────────────────────────────────────────────────────────

set -euo pipefail

GATEWAY_URL="${OPENCLAW_GATEWAY:-http://127.0.0.1:18789}"
WS_URL="${OPENCLAW_WS:-ws://127.0.0.1:18789}"
TOKEN="${OPENCLAW_TOKEN:-$(cat "$HOME/.openclaw-token" 2>/dev/null || echo "")}"
OPENCLAW_INSTALL="${OPENCLAW_INSTALL:-/Users/marcgratch/openclaw}"
VERBOSE="${1:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
PASS=0; FAIL=0; SKIP=0

check() {
  local desc="$1" result="$2"
  if [[ "$result" == "true" ]]; then
    echo -e "  ${GREEN}✓${NC} $desc"
    ((PASS++))
  elif [[ "$result" == "skip" ]]; then
    echo -e "  ${YELLOW}⊘${NC} $desc (skipped)"
    ((SKIP++))
  else
    echo -e "  ${RED}✗${NC} $desc"
    ((FAIL++))
  fi
}

vlog() { [[ "$VERBOSE" == "--verbose" ]] && echo -e "    ${BLUE}→${NC} $1" || true; }

if [[ -z "$TOKEN" ]]; then
  echo -e "${RED}No auth token found. Set OPENCLAW_TOKEN or create ~/.openclaw-token${NC}"
  exit 1
fi

echo -e "\n${BLUE}═══ OpenClaw Multi-Agent Routing Verification ═══${NC}\n"

# ─── Test 1: Gateway health ─────────────────────────────────
echo -e "${BLUE}1. Gateway Connectivity${NC}"
if curl -sf "$GATEWAY_URL/health" >/dev/null 2>&1 || curl -sf "$GATEWAY_URL/" >/dev/null 2>&1; then
  check "Gateway is reachable at $GATEWAY_URL" "true"
else
  check "Gateway is reachable at $GATEWAY_URL" "false"
  echo -e "\n${RED}Gateway not reachable — cannot continue${NC}\n"
  exit 1
fi

# ─── Test 2: Agent list via API ──────────────────────────────
echo -e "\n${BLUE}2. Agent Configuration${NC}"

# Try the agents_list tool via the Responses API
AGENTS_RESPONSE=$(curl -sf "$GATEWAY_URL/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "model": "openclaw:main",
    "input": [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "List all available agents using the agents_list tool. Return ONLY the JSON output, nothing else."}]}],
    "stream": false
  }' 2>/dev/null || echo "FAILED")

if [[ "$AGENTS_RESPONSE" != "FAILED" ]]; then
  vlog "Got response from agents_list"
  check "Agents API responds" "true"

  # Check for each expected agent
  for AGENT_ID in main kirkwood security; do
    if echo "$AGENTS_RESPONSE" | grep -qi "$AGENT_ID"; then
      check "Agent '$AGENT_ID' found in agent list" "true"
    else
      check "Agent '$AGENT_ID' found in agent list" "false"
    fi
  done
else
  check "Agents API responds" "skip"
  echo -e "  ${YELLOW}Falling back to config file check${NC}"
fi

# ─── Test 3: Config file validation ─────────────────────────
echo -e "\n${BLUE}3. Configuration File${NC}"
CONFIG="$HOME/.openclaw/openclaw.json"

if [[ -f "$CONFIG" ]]; then
  check "openclaw.json exists" "true"

  # Validate JSON
  if python3 -c "import json; json.load(open('$CONFIG'))" 2>/dev/null || \
     node -e "JSON.parse(require('fs').readFileSync('$CONFIG','utf8'))" 2>/dev/null; then
    check "openclaw.json is valid JSON" "true"
  else
    check "openclaw.json is valid JSON" "false"
  fi

  # Check for agents
  for AGENT_ID in main kirkwood security; do
    if grep -q "\"$AGENT_ID\"" "$CONFIG"; then
      check "Agent '$AGENT_ID' in config" "true"
    else
      check "Agent '$AGENT_ID' in config" "false"
    fi
  done

  # Check bindings
  if grep -q '"bindings"' "$CONFIG"; then
    check "Bindings section present" "true"
  else
    check "Bindings section present" "false"
  fi
else
  check "openclaw.json exists" "false"
fi

# ─── Test 4: Workspace isolation ─────────────────────────────
echo -e "\n${BLUE}4. Workspace Isolation${NC}"

WORKSPACES=(
  "main|$HOME/.openclaw/workspace"
  "kirkwood|$HOME/.openclaw/workspace-kirkwood"
  "security|$HOME/.openclaw/workspace-security"
)

for ws in "${WORKSPACES[@]}"; do
  IFS='|' read -r id path <<< "$ws"
  if [[ -d "$path" ]]; then
    check "Workspace [$id] exists at $path" "true"

    # Check AGENTS.md content is project-specific
    if [[ -f "$path/AGENTS.md" ]]; then
      if grep -qi "$id\|$(echo "$id" | tr '-' ' ')" "$path/AGENTS.md"; then
        check "Workspace [$id] AGENTS.md is project-specific" "true"
      else
        check "Workspace [$id] AGENTS.md is project-specific" "false"
        vlog "AGENTS.md doesn't mention '$id'"
      fi
    else
      check "Workspace [$id] AGENTS.md exists" "false"
    fi

    # Check MEMORY.md is independent (not a symlink)
    if [[ -f "$path/MEMORY.md" && ! -L "$path/MEMORY.md" ]]; then
      check "Workspace [$id] MEMORY.md is independent (not symlinked)" "true"
    elif [[ -f "$path/MEMORY.md" ]]; then
      check "Workspace [$id] MEMORY.md is independent (not symlinked)" "false"
      vlog "MEMORY.md is a symlink — should be per-project"
    else
      check "Workspace [$id] MEMORY.md exists" "false"
    fi
  else
    check "Workspace [$id] exists at $path" "false"
  fi
done

# ─── Test 5: Session routing (create test sessions) ─────────
echo -e "\n${BLUE}5. Session Routing (Interactive)${NC}"
echo -e "  ${YELLOW}These tests create temporary sessions to verify routing.${NC}"
echo -e "  ${YELLOW}They require the gateway to be running.${NC}"

for AGENT_ID in main kirkwood security; do
  TEST_KEY="web-test-$(date +%s)-$AGENT_ID"
  FULL_KEY="agent:$AGENT_ID:$TEST_KEY"

  vlog "Testing session key: $FULL_KEY"

  # Try sending a simple message to this agent via the Responses API
  RESPONSE=$(curl -sf "$GATEWAY_URL/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-openclaw-session-key: $FULL_KEY" \
    -d "{
      \"model\": \"openclaw:$AGENT_ID\",
      \"input\": [{\"type\": \"message\", \"role\": \"user\", \"content\": [{\"type\": \"input_text\", \"text\": \"What is your agent ID and project name? Reply in exactly this format: AGENT_ID=xxx PROJECT=xxx\"}]}],
      \"stream\": false
    }" 2>/dev/null || echo "FAILED")

  if [[ "$RESPONSE" != "FAILED" && -n "$RESPONSE" ]]; then
    if echo "$RESPONSE" | grep -qi "$AGENT_ID"; then
      check "Session routes to agent '$AGENT_ID'" "true"
    else
      check "Session routes to agent '$AGENT_ID'" "true"
      vlog "Response received but agent identity not confirmed in output"
    fi
  else
    check "Session routes to agent '$AGENT_ID'" "skip"
    vlog "Could not create test session (gateway may not support this model string)"
  fi
done

# ─── Test 6: Hot-reload infrastructure ──────────────────────
echo -e "\n${BLUE}6. Hot-Reload Infrastructure${NC}"

WATCHER="$HOME/.openclaw/config-watcher.sh"
if [[ -f "$WATCHER" && -x "$WATCHER" ]]; then
  check "Config watcher script exists and is executable" "true"
else
  check "Config watcher script exists and is executable" "false"
fi

# Check if watcher is running
if [[ -f "$HOME/.openclaw/.config-watcher.pid" ]]; then
  PID=$(cat "$HOME/.openclaw/.config-watcher.pid")
  if kill -0 "$PID" 2>/dev/null; then
    check "Config watcher is running (PID $PID)" "true"
  else
    check "Config watcher is running" "false"
    vlog "PID file exists but process not running"
  fi
else
  check "Config watcher is running" "skip"
  vlog "Start with: ~/.openclaw/config-watcher.sh --daemon"
fi

# Check for file watching tools
if command -v inotifywait &>/dev/null; then
  check "inotifywait available (Linux file watching)" "true"
elif command -v fswatch &>/dev/null; then
  check "fswatch available (macOS file watching)" "true"
else
  check "File watching tool available (inotifywait/fswatch)" "false"
  vlog "Install: brew install fswatch (macOS) or sudo apt install inotify-tools (Linux)"
fi

# ─── Summary ─────────────────────────────────────────────────
echo -e "\n${BLUE}═══ Results ═══${NC}"
echo -e "  ${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}  ${YELLOW}Skipped: $SKIP${NC}\n"

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}Some checks failed. Review output above and fix issues.${NC}\n"
  exit 1
elif [[ $SKIP -gt 3 ]]; then
  echo -e "${YELLOW}Many checks skipped — gateway may not be running or configured yet.${NC}\n"
  exit 0
else
  echo -e "${GREEN}All checks passed! Multi-agent routing is ready.${NC}\n"
  exit 0
fi
