// Loads every check module. Import order determines report order — group
// related checks so the report reads naturally when read top-to-bottom.

import "./memory-firewall.mjs";
import "./mounts-permissions.mjs";
import "./history-recovery.mjs";
import "./transcript-archive.mjs";
import "./streaming-cleanup.mjs";
import "./runner-recovery.mjs";
import "./two-tab-scoping.mjs";
import "./steering.mjs";
import "./acp.mjs";
import "./mcp-bridge.mjs";
import "./attachments.mjs";
import "./model-provenance.mjs";
import "./fallback-persistence.mjs";
import "./ui-checkpoint.mjs";
import "./project-files.mjs";
import "./browser-isolation.mjs";
import "./auth.mjs";
import "./runtime-infra.mjs";
import "./providers.mjs";
import "./docs.mjs";
