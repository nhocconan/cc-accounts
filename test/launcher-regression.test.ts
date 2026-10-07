import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), build: vi.fn(), get: vi.fn(), find: vi.fn(), locked: false }));
vi.mock("../src/core/registry.ts", () => ({ find: mocks.find }));
vi.mock("../src/core/lock.ts", () => ({ withMutationLock: async (_slug: string, action: () => Promise<unknown>) => { mocks.locked = true; try { return await action(); } finally { mocks.locked = false; } } }));
vi.mock("cross-spawn", () => ({ default: mocks.spawn }));
vi.mock("../src/core/credstore.ts", () => ({ get: mocks.get }));
vi.mock("../src/core/isolation.ts", () => ({ build: mocks.build }));
vi.mock("../src/core/paths.ts", () => ({ resolveClaudeBin: () => "claude" }));
vi.mock("../src/core/settings.ts", () => ({ writeStatusSettings: async () => "" }));
vi.mock("../src/core/usage.ts", () => ({ fiveHourNearLimit: async () => ({ ok: false }) }));
import { buildEnv, launch } from "../src/core/launcher.ts";
import type { Account } from "../src/core/registry.ts";
const account = { slug: "work", label: "Work", service: "fixture" } as Account;
mocks.find.mockImplementation(async () => account);
afterEach(() => { mocks.find.mockImplementation(async () => account); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("launcher isolation and failures", () => {
  it("scrubs competing authentication and sets the isolated config", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "wrong-account");
    vi.stubEnv("CLAUDE_CONFIG_DIR", "wrong-home");
    const env = buildEnv("fixture-token", account, "isolated-home");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe("isolated-home");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("fixture-token");
  });
  it("does not launch when isolation fails", async () => {
    mocks.get.mockResolvedValue("fixture");
    mocks.build.mockRejectedValue(new Error("cannot isolate"));
    mocks.spawn.mockClear();
    await expect(launch(account, [])).rejects.toThrow("cannot isolate");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("rejects spawn failures and removes signal handlers", async () => {
    mocks.get.mockResolvedValue("fixture");
    mocks.build.mockResolvedValue("fixture-home");
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    mocks.spawn.mockReturnValue(child);
    const before = process.listenerCount("SIGINT");
    const result = launch(account, ["--print", "a b"]);
    await vi.waitFor(() => expect(process.listenerCount("SIGINT")).toBe(before + 1));
    process.emit("SIGINT");
    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    process.emit("SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("error", new Error("ENOENT"));
    await expect(result).rejects.toThrow("could not start Claude (claude): ENOENT");
    expect(process.listenerCount("SIGINT")).toBe(before);
    expect(mocks.spawn.mock.calls.at(-1)?.[1]).toEqual(["--print", "a b"]);
  });
});

it("revalidates the latest account before reading its token and building isolation", async () => {
  const latest = { ...account, label: "Renamed", service: "updated-service", overrides: { settings: { model: "fixture" } } };
  mocks.find.mockResolvedValue(latest);
  mocks.get.mockResolvedValue("fixture");
  mocks.build.mockResolvedValue("fixture-home");
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  mocks.spawn.mockImplementation(() => { expect(mocks.locked).toBe(false); return child; });
  const result = launch(account, []);
  await vi.waitFor(() => expect(mocks.build).toHaveBeenLastCalledWith(latest));
  await vi.waitFor(() => expect(mocks.spawn.mock.calls.at(-1)?.[2]?.env.CLAUDE_ACCOUNTS_LABEL).toBe("Renamed"));
  expect(mocks.get).toHaveBeenLastCalledWith("updated-service");
  expect(mocks.locked).toBe(false);
  child.emit("exit", 0, null);
  await expect(result).resolves.toEqual({ code: 0 });
});
it("aborts if the account disappeared before preflight", async () => {
  mocks.find.mockResolvedValue(undefined);
  mocks.spawn.mockClear();
  await expect(launch(account, [])).rejects.toThrow("unknown account: work");
  expect(mocks.spawn).not.toHaveBeenCalled();
});
