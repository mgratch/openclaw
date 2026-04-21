#!/usr/bin/env node
// Minimal OpenAI Codex OAuth re-auth script.
// Runs the OAuth flow, prints the credentials as JSON, exits.
// Does NOT touch config or auth-profiles — that's done manually.

import { loginOpenAICodex } from "@mariozechner/pi-ai";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, output: process.stderr });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

console.error("\n=== OpenAI Codex OAuth Re-auth ===\n");

try {
  const creds = await loginOpenAICodex({
    onAuth: async ({ url }) => {
      console.error("Open this URL in your browser:\n");
      console.error(url);
      console.error("");
    },
    onPrompt: async (prompt) => {
      const answer = await ask((prompt.message || "Paste redirect URL") + ": ");
      return answer.trim();
    },
    onProgress: (msg) => {
      console.error(`  ... ${msg}`);
    },
  });

  // Print credentials as JSON to stdout (only thing on stdout)
  console.log(JSON.stringify(creds, null, 2));
  console.error("\n=== Done! Credentials printed above. ===\n");
} catch (err) {
  console.error("OAuth failed:", err.message || err);
  process.exit(1);
} finally {
  rl.close();
}
