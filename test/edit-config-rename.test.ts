import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));
vi.mock("../src/core/credstore.ts", () => store);
vi.mock("../src/core/registry.ts", async (original) => {
  const actual = await original<typeof import("../src/core/registry.ts")>();
  return { ...actual, rewrite: vi.fn(actual.rewrite) };
});
vi.mock("../src/core/wrappers.ts", () => ({ syncCurrent: vi.fn() }));
vi.mock("../src/commands/util.ts", () => ({ clearUsage: vi.fn() }));
import * as registry from "../src/core/registry.ts";
import { edit } from "../src/commands/edit.ts";
let root: string;
const acct = { slug: "work", label: "Work", service: "Claude Accounts: claude-work", createdAt: "2026-01-01" };
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "cca-rename-"));
  vi.stubEnv("CLAUDE_ACCOUNTS_DIR", root);
  vi.stubEnv("CLAUDE_ACCOUNTS_FILE", join(root, "accounts.json"));
  vi.stubEnv("CLAUDE_ACCOUNTS_CONFIG_DIR", join(root, "configs"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  store.get.mockReset().mockImplementation(async (service) => service === acct.service ? "synthetic-token" : "");
  store.set.mockReset().mockResolvedValue(undefined);
  store.del.mockReset().mockResolvedValue(undefined);
  const actual = await vi.importActual<typeof registry>("../src/core/registry.ts");
  vi.mocked(registry.rewrite).mockReset().mockImplementation(actual.rewrite);
  await registry.append(acct);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
async function writeLocalConfig() {
  await fs.mkdir(join(root, "configs", "work", "local-session"), { recursive: true });
  await fs.writeFile(join(root, "configs", "work", "local-session", "data.txt"), "account local data");
  await fs.writeFile(join(root, "configs", "work", ".credentials.json"), "synthetic-local-credential");
}
describe("account config rename", () => {
  it("moves local account data and credentials to the new suffix", async () => {
    await writeLocalConfig();
    await edit("work", { name: "Work", slug: "new" });
    expect(await registry.find("work")).toBeUndefined();
    expect((await registry.find("new"))?.service).toBe(registry.serviceFor("new"));
    expect(await fs.readFile(join(root, "configs", "new", "local-session", "data.txt"), "utf8")).toBe("account local data");
    expect(await fs.readFile(join(root, "configs", "new", ".credentials.json"), "utf8")).toBe("synthetic-local-credential");
    await expect(fs.lstat(join(root, "configs", "work"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects an orphan destination before touching either account", async () => {
    await writeLocalConfig();
    await fs.mkdir(join(root, "configs", "new"), { recursive: true });
    await fs.writeFile(join(root, "configs", "new", "orphan.txt"), "preserve orphan");
    await expect(edit("work", { name: "Work", slug: "new" })).rejects.toThrow("already exists");
    expect(await fs.readFile(join(root, "configs", "new", "orphan.txt"), "utf8")).toBe("preserve orphan");
    expect(await fs.readFile(join(root, "configs", "work", ".credentials.json"), "utf8")).toBe("synthetic-local-credential");
    expect(await registry.find("work")).toEqual(acct);
    expect(store.set).not.toHaveBeenCalled();
  });
  it("rolls config and destination token back when registry rewrite fails", async () => {
    await writeLocalConfig();
    vi.mocked(registry.rewrite).mockRejectedValue(new Error("disk full"));
    await expect(edit("work", { name: "Work", slug: "new" })).rejects.toThrow("disk full");
    expect(await fs.readFile(join(root, "configs", "work", ".credentials.json"), "utf8")).toBe("synthetic-local-credential");
    await expect(fs.lstat(join(root, "configs", "new"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await registry.find("work")).toEqual(acct);
    expect(store.set.mock.calls).toEqual([[registry.serviceFor("new"), "synthetic-token"]]);
    expect(store.del).toHaveBeenCalledWith(registry.serviceFor("new"));
  });
  it("preserves local config data even when the credential store has no token", async () => {
    await writeLocalConfig();
    store.get.mockResolvedValue("");
    await edit("work", { name: "Work", slug: "new" });
    expect(await fs.readFile(join(root, "configs", "new", ".credentials.json"), "utf8")).toBe("synthetic-local-credential");
    expect(store.set).not.toHaveBeenCalled();
  });
  it.each(["", "synthetic-source-token"])("does not overwrite an orphan destination credential when source token is %s", async (sourceToken) => {
    await writeLocalConfig();
    store.get.mockImplementation(async service => service === acct.service ? sourceToken : "synthetic-orphan-token");
    await expect(edit("work", { name: "Work", slug: "new" })).rejects.toThrow("destination credential already exists");
    expect(await registry.find("work")).toEqual(acct);
    expect(await fs.readFile(join(root, "configs", "work", ".credentials.json"), "utf8")).toBe("synthetic-local-credential");
    expect(store.set).not.toHaveBeenCalled();
    expect(store.del).not.toHaveBeenCalled();
  });
  it("restores the destination token if moving the source config fails", async () => {
    await writeLocalConfig();
    vi.spyOn(fs, "rename").mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    await expect(edit("work", { name: "Work", slug: "new" })).rejects.toThrow("permission denied");
    expect(await registry.find("work")).toEqual(acct);
    expect(store.del).toHaveBeenCalledWith(registry.serviceFor("new"));
    expect(await fs.readFile(join(root, "configs", "work", ".credentials.json"), "utf8")).toBe("synthetic-local-credential");
  });
  it("tolerates an account never launched with no config directory", async () => {
    await edit("work", { name: "Work", slug: "new" });
    expect(await registry.find("new")).toBeDefined();
    await expect(fs.lstat(join(root, "configs", "new"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
