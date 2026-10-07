import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));
const registry = vi.hoisted(() => ({ find: vi.fn(), load: vi.fn(), append: vi.fn(), rewrite: vi.fn(), remove: vi.fn() }));
vi.mock("../src/core/credstore.ts", () => store);
vi.mock("../src/core/registry.ts", async (original) => ({ ...await original<typeof import("../src/core/registry.ts")>(), ...registry }));
vi.mock("../src/core/lock.ts", () => ({ withMutationLock: (_: unknown, action: () => unknown) => action(), withMutationLocks: (_: unknown, action: () => unknown) => action() }));
vi.mock("../src/core/wrappers.ts", () => ({ syncCurrent: vi.fn() }));
vi.mock("../src/commands/util.ts", () => ({ clearUsage: vi.fn() }));
vi.mock("../src/ui/select.ts", () => ({ confirm: async () => true, promptLine: vi.fn(), pressEnter: vi.fn() }));
import { add } from "../src/commands/add.ts";
import { edit } from "../src/commands/edit.ts";
import { remove } from "../src/commands/remove.ts";
const token = "sk-ant-oat01-" + "x".repeat(40);
const acct = { slug: "work", label: "Work", service: "Claude Accounts: claude-work", createdAt: "2026-01-01" };
beforeEach(() => { vi.resetAllMocks(); registry.load.mockResolvedValue([]); store.get.mockResolvedValue(""); vi.spyOn(console, "log").mockImplementation(() => {}); });
describe("command commit boundaries", () => {
  it.each(["[]", "null", "4", "bad json"])("rejects settings %s before storing a credential", async settings => {
    registry.find.mockResolvedValue(undefined);
    await expect(add({ name: "Work", slug: "work", token, settings })).rejects.toThrow("JSON object");
    expect(store.set).not.toHaveBeenCalled();
    expect(registry.append).not.toHaveBeenCalled();
  });
  it("restores orphan credential when registry append fails", async () => {
    registry.find.mockResolvedValue(undefined); store.get.mockResolvedValue("previous-token");
    registry.append.mockRejectedValue(new Error("disk full"));
    await expect(add({ name: "Work", slug: "work", token })).rejects.toThrow("disk full");
    expect(store.set.mock.calls).toEqual([[acct.service, token], [acct.service, "previous-token"]]);
  });
  it("rename registry failure retains old credential and rolls back new credential", async () => {
    registry.find.mockImplementation(async slug => slug === "work" ? acct : undefined);
    store.get.mockImplementation(async service => service === acct.service ? token : "");
    registry.rewrite.mockRejectedValue(new Error("disk full"));
    await expect(edit("work", { name: "Work", slug: "new" })).rejects.toThrow("disk full");
    expect(store.del.mock.calls).toEqual([["Claude Accounts: claude-new"]]);
  });
  it("does not remove registry entry when credential deletion fails", async () => {
    registry.find.mockResolvedValue(acct); store.get.mockResolvedValue(token); store.del.mockRejectedValue(new Error("locked store"));
    await expect(remove("work")).rejects.toThrow("locked store");
    expect(registry.remove).not.toHaveBeenCalled();
  });
  it("restores removed credential on registry failure", async () => {
    registry.find.mockResolvedValue(acct); store.get.mockResolvedValue(token); registry.remove.mockRejectedValue(new Error("disk full"));
    await expect(remove("work")).rejects.toThrow("disk full");
    expect(store.set).toHaveBeenCalledWith(acct.service, token);
  });
});
