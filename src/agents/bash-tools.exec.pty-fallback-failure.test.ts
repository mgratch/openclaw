import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { listRunningSessions, resetProcessRegistryForTests } from "./bash-process-registry.js";

// bash-tools.exec.js is imported lazily below, NOT statically. The unit surface
// runs with isolate:false, so files in a worker share one module registry: a
// sibling that imports bash-tools.exec first caches a copy bound to the REAL
// process supervisor, and this file's vi.mock then has no effect — the spawn
// rejections never fire and the test resolves instead of rejecting.
let createExecTool: typeof import("./bash-tools.exec.js").createExecTool;

const { supervisorSpawnMock } = vi.hoisted(() => ({
  supervisorSpawnMock: vi.fn(),
}));

const makeSupervisor = () => {
  const noop = vi.fn();
  return {
    spawn: (...args: unknown[]) => supervisorSpawnMock(...args),
    cancel: noop,
    cancelScope: noop,
    reconcileOrphans: noop,
    getRecord: noop,
  };
};

vi.mock("../process/supervisor/index.js", () => ({
  getProcessSupervisor: () => makeSupervisor(),
}));

beforeAll(async () => {
  // Drop anything a sibling cached, then bind the subject to this file's mocks.
  vi.resetModules();
  ({ createExecTool } = await import("./bash-tools.exec.js"));
});

afterEach(() => {
  resetProcessRegistryForTests();
  vi.clearAllMocks();
});

test("exec cleans session state when PTY fallback spawn also fails", async () => {
  supervisorSpawnMock
    .mockRejectedValueOnce(new Error("pty spawn failed"))
    .mockRejectedValueOnce(new Error("child fallback failed"));

  const tool = createExecTool({
    allowBackground: false,
    host: "gateway",
    security: "full",
    ask: "off",
  });

  await expect(
    tool.execute("toolcall", {
      command: "echo ok",
      pty: true,
    }),
  ).rejects.toThrow("child fallback failed");

  expect(listRunningSessions()).toHaveLength(0);
});
