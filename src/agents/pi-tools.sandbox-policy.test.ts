import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { createOpenClawCodingTools } from "./pi-tools.js";
import { resolveSandboxConfigForAgent } from "./sandbox/config.js";
import { createHostSandboxFsBridge } from "./test-helpers/host-sandbox-fs-bridge.js";
import { createPiToolsSandboxContext } from "./test-helpers/pi-tools-sandbox-context.js";

function listToolNames(params: {
  cfg: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  sandboxAgentId?: string;
}): string[] {
  const workspaceDir = "/tmp/openclaw-sandbox-policy";
  const sessionKey = params.sessionKey ?? "agent:tavern:main";
  const sandboxAgentId = params.sandboxAgentId ?? params.agentId ?? "tavern";
  const sandbox = createPiToolsSandboxContext({
    workspaceDir,
    fsBridge: createHostSandboxFsBridge(workspaceDir),
    sessionKey,
    tools: resolveSandboxConfigForAgent(params.cfg, sandboxAgentId).tools,
  });
  return createOpenClawCodingTools({
    config: params.cfg,
    agentId: params.agentId,
    sessionKey,
    sandbox,
    workspaceDir,
  })
    .map((tool) => tool.name)
    .toSorted();
}

// These cases used "browser" as the stand-in for a sandbox-omitted tool, but
// browser is a plugin now (extensions/browser), so createOpenClawCodingTools
// can never return it and the assertions could only fail. "tts" is the
// equivalent core tool: omitted from the sandbox surface by default and
// re-exposed through allow / alsoAllow, which is what these tests are about.
const SANDBOX_OMITTED_CORE_TOOL = "tts";

describe("pi-tools sandbox policy", () => {
  it("re-exposes omitted sandbox tools via sandbox alsoAllow", () => {
    const names = listToolNames({
      cfg: {
        agents: {
          defaults: {
            sandbox: { mode: "all", scope: "agent" },
          },
          list: [
            {
              id: "tavern",
              tools: {
                sandbox: {
                  tools: {
                    alsoAllow: ["message", "tts"],
                  },
                },
              },
            },
          ],
        },
      } as OpenClawConfig,
    });

    expect(names).toContain("message");
    expect(names).toContain("tts");
  });

  it("re-enables default-denied sandbox tools when explicitly allowed", () => {
    const names = listToolNames({
      cfg: {
        agents: {
          defaults: {
            sandbox: { mode: "all", scope: "agent" },
          },
          list: [{ id: "tavern" }],
        },
        tools: {
          sandbox: {
            tools: {
              allow: [SANDBOX_OMITTED_CORE_TOOL],
            },
          },
        },
      } as OpenClawConfig,
    });

    expect(names).toContain(SANDBOX_OMITTED_CORE_TOOL);
  });

  it("prefers the resolved sandbox context policy for legacy main session aliases", () => {
    const cfg = {
      agents: {
        defaults: {
          sandbox: { mode: "all", scope: "agent" },
        },
        list: [
          {
            id: "tavern",
            default: true,
            tools: {
              sandbox: {
                tools: {
                  allow: [SANDBOX_OMITTED_CORE_TOOL],
                  alsoAllow: ["message"],
                },
              },
            },
          },
        ],
      },
    } as OpenClawConfig;

    const names = listToolNames({
      cfg,
      sessionKey: "main",
      sandboxAgentId: "tavern",
    });

    expect(names).toContain(SANDBOX_OMITTED_CORE_TOOL);
    expect(names).toContain("message");
  });

  it("preserves allow-all semantics for allow: [] plus alsoAllow", () => {
    const names = listToolNames({
      cfg: {
        agents: {
          defaults: {
            sandbox: { mode: "all", scope: "agent" },
          },
          list: [{ id: "tavern" }],
        },
        tools: {
          sandbox: {
            tools: {
              allow: [],
              alsoAllow: [SANDBOX_OMITTED_CORE_TOOL],
            },
          },
        },
      } as OpenClawConfig,
    });

    expect(names).toContain(SANDBOX_OMITTED_CORE_TOOL);
    expect(names).toContain("read");
  });

  it("keeps explicit sandbox deny precedence over explicit allow", () => {
    const names = listToolNames({
      cfg: {
        agents: {
          defaults: {
            sandbox: { mode: "all", scope: "agent" },
          },
          list: [{ id: "tavern" }],
        },
        tools: {
          sandbox: {
            tools: {
              allow: ["browser", "message"],
              deny: ["browser"],
            },
          },
        },
      } as OpenClawConfig,
    });

    expect(names).not.toContain("browser");
    expect(names).toContain("message");
  });
});
