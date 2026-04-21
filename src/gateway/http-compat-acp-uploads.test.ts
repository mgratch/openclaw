import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentCommand, getFreePort, installGatewayTestHooks } from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let startGatewayServer: typeof import("./server.js").startGatewayServer;
let server: Awaited<ReturnType<typeof startServer>>;
let port: number;

beforeAll(async () => {
  ({ startGatewayServer } = await import("./server.js"));
  port = await getFreePort();
  server = await startServer(port);
});

afterAll(async () => {
  await server.close({ reason: "acp upload compat suite done" });
});

beforeEach(() => {
  agentCommand.mockReset();
});

async function startServer(port: number) {
  return await startGatewayServer(port, {
    host: "127.0.0.1",
    auth: { mode: "none" },
    controlUiEnabled: false,
    openAiChatCompletionsEnabled: true,
    openResponsesEnabled: true,
  });
}

async function postChatCompletions(body: unknown, headers?: Record<string, string>) {
  return await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-openclaw-scopes": "operator.write",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function postResponses(body: unknown, headers?: Record<string, string>) {
  return await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-openclaw-scopes": "operator.write",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function ensureResponseConsumed(res: Response) {
  if (!res.bodyUsed) {
    await res.text();
  }
}

describe("ACP preset uploads on HTTP compat endpoints", () => {
  it("routes chat-completions image uploads through the ACP preset agent", async () => {
    const imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA";
    agentCommand.mockResolvedValueOnce({ payloads: [{ text: "ok" }] } as never);

    const res = await postChatCompletions({
      model: "claude-code-opus",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe this with ACP" },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${imageData}` },
            },
          ],
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(agentCommand).toHaveBeenCalledTimes(1);

    const opts = (agentCommand.mock.calls[0] as unknown[] | undefined)?.[0] as
      | {
          model?: string;
          sessionKey?: string;
          message?: string;
          images?: Array<{ type: string; data: string; mimeType: string }>;
        }
      | undefined;

    expect(opts?.model).toBe("claude-code-opus");
    expect(opts?.sessionKey ?? "").toMatch(/^agent:claude-code:/);
    expect(opts?.message).toBe("describe this with ACP");
    expect(opts?.images).toEqual([{ type: "image", data: imageData, mimeType: "image/png" }]);
    await ensureResponseConsumed(res);
  });

  it("routes OpenResponses file uploads through the ACP preset agent", async () => {
    agentCommand.mockResolvedValueOnce({ payloads: [{ text: "ok" }] } as never);

    const res = await postResponses({
      model: "claude-code-opus",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "read this with ACP" },
            {
              type: "input_file",
              source: {
                type: "base64",
                media_type: "text/markdown",
                data: Buffer.from("# hello\n\nworld").toString("base64"),
                filename: "hello.md",
              },
            },
          ],
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(agentCommand).toHaveBeenCalledTimes(1);

    const opts = (agentCommand.mock.calls[0] as unknown[] | undefined)?.[0] as
      | {
          model?: string;
          sessionKey?: string;
          message?: string;
          extraSystemPrompt?: string;
        }
      | undefined;

    expect(opts?.model).toBe("claude-code-opus");
    expect(opts?.sessionKey ?? "").toMatch(/^agent:claude-code:/);
    expect(opts?.message).toBe("read this with ACP");
    expect(opts?.extraSystemPrompt ?? "").toContain('<file name="hello.md">');
    await ensureResponseConsumed(res);
  });
});
