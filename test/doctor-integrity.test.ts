import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "", token: "sk-ant-oat01-" + "x".repeat(40), unavailable: false }));
vi.mock("../src/core/registry.ts", () => ({
  load: async () => [{ slug: "work", label: "Work", service: "test" }],
  command: () => "claude-work",
}));
vi.mock("../src/core/credstore.ts", () => ({ get: async () => {
  if (state.unavailable) throw new Error("secret must never appear");
  return state.token;
} }));
vi.mock("../src/core/usage.ts", () => ({ summary: async () => "usage pending", fingerprint: async () => "" }));
vi.mock("../src/core/paths.ts", () => ({
  configDirFor: () => state.root,
  defaultBinDir: () => state.root,
  resolveClaudeBin: () => join(state.root, "manager.js"),
  resolveSelfBinary: () => join(state.root, "manager.js"),
}));
import { doctor } from "../src/commands/doctor.ts";

const launcher = () => join(state.root, `claude-work${process.platform === "win32" ? ".cmd" : ""}`);
beforeEach(async () => {
  state.root = await fs.mkdtemp(join(tmpdir(), "cca-doctor-"));
  state.unavailable = false;
  await fs.writeFile(join(state.root, "manager.js"), "manager");
  await fs.writeFile(join(state.root, ".claude.json"), "{}");
  await fs.writeFile(launcher(), "// cc-accounts launcher");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(state.root, { recursive: true, force: true }); });

describe("doctor local integrity", () => {
  it("accepts a healthy owned launcher and stripped config", async () => {
    await expect(doctor()).resolves.toBe(0);
  });
  it.each(["null", "[]", '{"oauthAccount":{"private":"never print"}}', "bad json"])("rejects unsafe identity %s", async content => {
    await fs.writeFile(join(state.root, ".claude.json"), content);
    await expect(doctor()).resolves.toBe(1);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("never print");
  });
  it("rejects missing identity and foreign launcher", async () => {
    await fs.unlink(join(state.root, ".claude.json"));
    await fs.writeFile(launcher(), "foreign");
    await expect(doctor()).resolves.toBe(1);
    const output = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(output).toContain(".claude.json is missing");
    expect(output).toContain("owned by another file");
  });
  it("rejects missing launcher", async () => {
    await fs.unlink(launcher());
    await expect(doctor()).resolves.toBe(1);
  });
  it("rejects a linked identity without reading its contents", async ({ skip }) => {
    await fs.unlink(join(state.root, ".claude.json"));
    const target = join(state.root, "private-identity");
    await fs.writeFile(target, '{"oauthAccount":"never print"}');
    try { await fs.symlink(target, join(state.root, ".claude.json")); }
    catch (error) {
      if (process.platform === "win32" && ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) skip();
      throw error;
    }
    await expect(doctor()).resolves.toBe(1);
    const output = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(output).toContain("must be a real file");
    expect(output).not.toContain("never print");
  });
  it("reports credential read failure without the original error", async () => {
    state.unavailable = true;
    await expect(doctor()).resolves.toBe(1);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("secret must never appear");
  });
  it("rejects private credential symlinks and accepts owned legacy launchers", async ({ skip }) => {
    await fs.unlink(launcher());
    try {
      await fs.symlink(join(state.root, "manager.js"), launcher());
      await fs.symlink(join(state.root, "absent-token"), join(state.root, ".credentials.json"));
    } catch (error) {
      if (process.platform === "win32" && ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) skip();
      throw error;
    }
    await expect(doctor()).resolves.toBe(1);
    const output = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(output).toContain("private .credentials.json is a symlink");
    expect(output).not.toContain("launcher is owned");
    await fs.unlink(join(state.root, ".credentials.json"));
    await expect(doctor()).resolves.toBe(0);
  });
});
