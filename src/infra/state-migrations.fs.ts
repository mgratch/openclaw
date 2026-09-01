import fs from "node:fs";
import JSON5 from "json5";

export type SessionEntryLike = {
  sessionId?: string;
  updatedAt?: number;
} & Record<string, unknown>;

export function safeReadDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function existsDir(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isLegacyWhatsAppAuthFile(name: string): boolean {
  if (name === "creds.json" || name === "creds.json.bak") {
    return true;
  }
  if (!name.endsWith(".json")) {
    return false;
  }
  return /^(app-state-sync|session|sender-key|pre-key)-/.test(name);
}

export function readSessionStoreJson5(storePath: string): {
  store: Record<string, SessionEntryLike>;
  ok: boolean;
} {
  try {
    const raw = fs.readFileSync(storePath, "utf-8");
    // Stores are written as strict JSON; JSON5 is only a fallback for
    // hand-edited files. The JSON5 parser is a JS-land lexer, ~2 orders of
    // magnitude slower than native JSON.parse — on multi-MB stores it burned
    // minutes of startup CPU (profiled at ~25% of the boot grind).
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = JSON5.parse(raw);
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { store: parsed as Record<string, SessionEntryLike>, ok: true };
    }
  } catch {
    // ignore
  }
  return { store: {}, ok: false };
}
