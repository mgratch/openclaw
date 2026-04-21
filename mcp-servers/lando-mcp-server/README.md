# 🐳 lando-mcp-server

An MCP (Model Context Protocol) server that lets OpenClaw manage Lando development environments — bridging the gap between OpenClaw's Docker container and your host machine where Lando runs.

## Architecture

```
┌────────────────────────────────────────────┐
│  Docker                                    │
│  ┌──────────────────────────────────────┐  │
│  │  OpenClaw Gateway Container          │  │
│  │  └─ Agent uses mcporter to call ─────┼──┼──┐
│  └──────────────────────────────────────┘  │  │
└────────────────────────────────────────────┘  │
                                                │ HTTP POST
┌───────────────────────────────────────────────┼──┐
│  HOST MACHINE                                 │  │
│  ┌──────────────────────────────────────┐     │  │
│  │  lando-mcp-server (HTTP :3456)  ◄────┼─────┘  │
│  │  ✅ Has Docker access                │        │
│  │  ✅ Has Lando CLI                    │        │
│  │  ✅ Can see ~/Sites/*                │        │
│  └──────────────────────────────────────┘        │
└──────────────────────────────────────────────────┘
```

Since OpenClaw runs in Docker, its agent **cannot** spawn host processes or access the host's Docker socket. The MCP server runs on the **host** with Streamable HTTP transport, and OpenClaw's agent reaches it via `mcporter` (the bundled MCP client skill) over HTTP.

## Prerequisites

- **Node.js** >= 18 on the host
- **Lando** installed and working on the host
- **OpenClaw** running in Docker
- **mcporter** skill enabled (bundled with OpenClaw)

## Installation

```bash
# On your host machine (where Lando is installed)
cd /Users/marcgratch/openclaw
mkdir -p mcp-servers
cd mcp-servers

# Copy or clone the lando-mcp-server here
cd lando-mcp-server
npm install
npm run build
```

## Running the Server

```bash
# Start on the host (default: http://127.0.0.1:3456/mcp)
node dist/index.js

# Custom port/bind
LANDO_MCP_PORT=4000 node dist/index.js

# Bind to all interfaces (needed if Docker uses bridge networking)
LANDO_MCP_BIND=0.0.0.0 LANDO_MCP_PORT=3456 node dist/index.js

# Run in background
nohup node dist/index.js > /tmp/lando-mcp.log 2>&1 &

# Or use stdio transport (for non-Docker setups)
TRANSPORT=stdio node dist/index.js
```

### Verify it's running

```bash
curl http://127.0.0.1:3456/health
# {"status":"ok","server":"lando-mcp-server","version":"1.0.0"}
```

## OpenClaw Integration (Docker)

Since OpenClaw runs in Docker, the agent needs to reach the host. The connection method depends on your Docker networking:

### Docker Desktop (macOS/Windows)

The host is reachable at `host.docker.internal`:

```
http://host.docker.internal:3456/mcp
```

### Linux Docker (bridge network)

Use the Docker bridge gateway IP (usually `172.17.0.1`):

```
http://172.17.0.1:3456/mcp
```

Or bind the server to `0.0.0.0` and use the host's LAN IP.

### Using mcporter (recommended)

The agent can call tools directly via mcporter CLI:

```bash
# Discover projects
mcporter call http://host.docker.internal:3456/mcp lando_discover_projects

# Start a project
mcporter call http://host.docker.internal:3456/mcp lando_start project=my-site

# Run WP-CLI
mcporter call http://host.docker.internal:3456/mcp lando_wp project=my-site args="plugin list"

# List running apps
mcporter call http://host.docker.internal:3456/mcp lando_list_running
```

### Add to mcporter config (persistent)

Ask your OpenClaw agent to configure mcporter, or manually edit the config:

```bash
mcporter config add lando --url http://host.docker.internal:3456/mcp
```

Then tools are callable by server name:

```bash
mcporter call lando.lando_discover_projects
mcporter call lando.lando_start project=my-site
mcporter call lando.lando_wp project=my-site args="plugin list"
```

### Alternative: OpenClaw MCP Plugin

You can also install the community [openclaw-mcp-plugin](https://github.com/lunarpulse/openclaw-mcp-plugin) in `~/.openclaw/extensions/` and configure it to connect to the lando-mcp-server URL. This exposes Lando tools as native agent tools.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSPORT` | `http` | Transport mode: `http` or `stdio` |
| `LANDO_MCP_PORT` | `3456` | HTTP server port |
| `LANDO_MCP_BIND` | `127.0.0.1` | HTTP bind address |
| `LANDO_PROJECTS_DIRS` | `~/Sites:~/projects:~/dev:~/code:~/workspace` | Colon-separated dirs to scan for Lando projects |

## Available Tools

### Discovery and Status

| Tool | Description |
|------|-------------|
| `lando_discover_projects` | Scan filesystem for all .lando.yml projects |
| `lando_list_running` | List currently running Lando apps |
| `lando_info` | Get detailed service info (URLs, ports, containers) |
| `lando_config` | Show resolved Lando configuration |

### Lifecycle

| Tool | Description |
|------|-------------|
| `lando_start` | Start a project |
| `lando_stop` | Stop a project |
| `lando_restart` | Restart a project |
| `lando_rebuild` | Rebuild containers from config |
| `lando_destroy` | Destroy project (removes volumes!) |
| `lando_poweroff` | Stop ALL Lando apps globally |

### Command Execution

| Tool | Description |
|------|-------------|
| `lando_exec` | Run any command in a service container |
| `lando_wp` | Run WP-CLI commands |
| `lando_composer` | Run Composer commands |
| `lando_npm` | Run npm commands |
| `lando_mysql` | Run MySQL queries |

### Database

| Tool | Description |
|------|-------------|
| `lando_db_export` | Export database to SQL dump |
| `lando_db_import` | Import SQL dump (replaces DB) |

### Logs

| Tool | Description |
|------|-------------|
| `lando_logs` | View service logs |

## Usage Examples

Once configured, ask OpenClaw things like:

- *"What Lando projects do I have?"*
- *"Start my client-site project"*
- *"Run wp plugin list on my-wordpress-site"*
- *"Check the logs for the database service"*
- *"Export the database before I make changes"*
- *"Stop all running Lando apps"*

## Running as a Service (launchd on macOS)

```bash
cat > ~/Library/LaunchAgents/com.lando-mcp-server.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lando-mcp-server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/marcgratch/openclaw/mcp-servers/lando-mcp-server/dist/index.js</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>LANDO_PROJECTS_DIRS</key>
        <string>/Users/marcgratch/Sites</string>
        <key>LANDO_MCP_BIND</key>
        <string>0.0.0.0</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/lando-mcp-server.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/lando-mcp-server.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.lando-mcp-server.plist
```

## Security Notes

- The MCP server runs on the **host** with your user's permissions
- By default it binds to `127.0.0.1` (localhost only)
- If you bind to `0.0.0.0`, anyone on your network can access it — consider adding auth
- Destructive commands (`destroy`, `rebuild`, `db-import`) are annotated so the agent can warn you
- `lando exec` runs commands inside Lando service containers (container-level permissions)

## Development

```bash
# Run in dev mode (auto-compiles TypeScript)
npm run dev

# Build for production
npm run build

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js

# Test the HTTP endpoint directly
curl -X POST http://127.0.0.1:3456/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Troubleshooting

**"Connection refused" from inside Docker**
- Verify the server is running on the host: `curl http://127.0.0.1:3456/health`
- Check Docker networking: try `host.docker.internal:3456` (Docker Desktop) or `172.17.0.1:3456` (Linux)
- Ensure server binds to `0.0.0.0` if Docker can't reach `127.0.0.1`

**"No Lando projects found"**
- Check `LANDO_PROJECTS_DIRS` points to the right directories
- Verify projects have `.lando.yml` or `.lando.yaml` files

**"Command timed out"**
- `lando start` and `lando rebuild` can take several minutes
- Default: 2 min for most commands, 5 min for start/rebuild/destroy

**"mcporter: command not found"**
- Ensure the mcporter skill is enabled in OpenClaw
- Try: `openclaw skills list | grep mcporter`
