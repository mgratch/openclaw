import { resolveSessionFilePath } from "./paths.js";
import { updateSessionStore } from "./store.js";
import type { SessionEntry } from "./types.js";

export async function resolveAndPersistSessionFile(params: {
  sessionId: string;
  sessionKey: string;
  sessionStore: Record<string, SessionEntry>;
  storePath: string;
  sessionEntry?: SessionEntry;
  agentId?: string;
  sessionsDir?: string;
  fallbackSessionFile?: string;
  activeSessionKey?: string;
  /** When true, skip the updateSessionStore write — the caller is responsible
   *  for including these changes in a subsequent batched write. This avoids
   *  redundant disk writes when the caller will immediately write anyway. */
  deferWrite?: boolean;
}): Promise<{ sessionFile: string; sessionEntry: SessionEntry }> {
  const { sessionId, sessionKey, sessionStore, storePath } = params;
  const baseEntry = params.sessionEntry ??
    sessionStore[sessionKey] ?? { sessionId, updatedAt: Date.now() };
  const fallbackSessionFile = params.fallbackSessionFile?.trim();
  const entryForResolve =
    !baseEntry.sessionFile && fallbackSessionFile
      ? { ...baseEntry, sessionFile: fallbackSessionFile }
      : baseEntry;
  const sessionFile = resolveSessionFilePath(sessionId, entryForResolve, {
    agentId: params.agentId,
    sessionsDir: params.sessionsDir,
  });
  const persistedEntry: SessionEntry = {
    ...baseEntry,
    sessionId,
    updatedAt: Date.now(),
    sessionFile,
  };
  if (baseEntry.sessionId !== sessionId || baseEntry.sessionFile !== sessionFile) {
    sessionStore[sessionKey] = persistedEntry;
    if (!params.deferWrite) {
      await updateSessionStore(
        storePath,
        (store) => {
          store[sessionKey] = {
            ...store[sessionKey],
            ...persistedEntry,
          };
        },
        params.activeSessionKey ? { activeSessionKey: params.activeSessionKey } : undefined,
      );
    }
    return { sessionFile, sessionEntry: persistedEntry };
  }
  sessionStore[sessionKey] = persistedEntry;
  return { sessionFile, sessionEntry: persistedEntry };
}
