import { promises as fs } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { defaultBinDir, resolveClaudeBin, resolveSelfBinary } from "../src/core/paths.ts";
let directory = "";
afterEach(async () => { vi.unstubAllEnvs(); if (directory) await fs.rm(directory, { recursive: true, force: true }); });
it("uses platform PATH delimiters and rejects directories as executables", async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "cca-paths-"));
  const first = join(directory, "first");
  const second = join(directory, "second");
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  await fs.mkdir(join(first, name), { recursive: true });
  await fs.mkdir(second);
  const candidate = join(second, name);
  await fs.writeFile(candidate, "fixture", { mode: 0o755 });
  vi.stubEnv("PATH", [first, second].join(delimiter));
  vi.stubEnv("CLAUDE_ACCOUNTS_CLAUDE_BIN", "");
  expect(resolveClaudeBin()).toBe(candidate);
});
it("rejects an explicit manager alias to prevent recursion", () => {
  vi.stubEnv("CLAUDE_ACCOUNTS_CLAUDE_BIN", resolveSelfBinary());
  expect(() => resolveClaudeBin()).toThrow("unavailable or points at cca");
});
it("does not choose transient npm launcher directories", async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "cca-paths-"));
  const transient = join(directory, "_npx", "bin");
  const stable = join(directory, "stable");
  await fs.mkdir(transient, { recursive: true });
  await fs.mkdir(stable);
  vi.stubEnv("CLAUDE_ACCOUNTS_BIN_DIR", "");
  vi.stubEnv("PATH", [transient, stable].join(delimiter));
  expect(defaultBinDir()).toBe(stable);
});
