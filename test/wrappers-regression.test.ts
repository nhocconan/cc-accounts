import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { launcherContent, sync, syncCurrent } from "../src/core/wrappers.ts";
import { withFileLock } from "../src/core/lock.ts";
import { VERSION } from "../src/version.ts";
import type { Account } from "../src/core/registry.ts";
let directory = "";
afterEach(async () => { vi.unstubAllEnvs(); if (directory) await fs.rm(directory, { recursive: true, force: true }); });
it("generated Node launchers preserve quoted paths, argument order and exit code", async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "cca-wrapper-"));
  const target = join(directory, "manager's file.cjs");
  await fs.writeFile(target, 'console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 7;');
  const wrapper = join(directory, "wrapper.cjs");
  await fs.writeFile(wrapper, launcherContent("work", target, false));
  try { execFileSync(process.execPath, [wrapper, "a b", "--flag", "quote'\""], { encoding: "utf8" }); throw new Error("expected exit 7"); }
  catch (error) {
    const result = error as { status: number; stdout: string };
    expect(result.status).toBe(7);
    expect(JSON.parse(result.stdout)).toEqual(["launch", "work", "--", "a b", "--flag", "quote'\""]);
  }
});
it("creates durable wrappers, refreshes owned files and preserves foreign commands", async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "cca-sync-"));
  vi.stubEnv("CLAUDE_ACCOUNTS_BIN_DIR", directory);
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const owned = join(directory, `claude-work${suffix}`);
  const foreign = join(directory, `claude-personal${suffix}`);
  await fs.writeFile(foreign, "user command");
  await sync([{ slug: "work" }, { slug: "personal" }] as Account[]);
  expect(await fs.readFile(owned, "utf8")).toContain("cc-accounts launcher");
  expect(await fs.readFile(foreign, "utf8")).toBe("user command");
  await sync([]);
  await expect(fs.stat(owned)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(foreign, "utf8")).toBe("user command");
});
it("uses isolated version-pinned npx fallback and Windows errorlevel outside blocks", () => {
  const unix = launcherContent("work", join(tmpdir(), "missing-cca"), false);
  expect(unix).toContain('"--prefix", os.tmpdir()');
  expect(unix).toContain(`"--package=cc-accounts@${VERSION}", "cca"`);
  const windows = launcherContent("work", join(tmpdir(), "missing-cca"), true);
  expect(windows).toContain("DisableDelayedExpansion");
  expect(windows).toContain(":done\r\nexit /b %errorlevel%");
});
it("serializes competing syncs and leaves complete launchers without temporary files", async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "cca-sync-"));
  vi.stubEnv("CLAUDE_ACCOUNTS_BIN_DIR", directory);
  await Promise.all([
    sync([{ slug: "first" }] as Account[]),
    sync([{ slug: "second" }] as Account[]),
  ]);
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const entries = await fs.readdir(directory);
  expect(entries).toEqual([`claude-second${suffix}`]);
  expect(await fs.readFile(join(directory, entries[0]!), "utf8")).toContain("cc-accounts launcher");
});

it("reloads current registry inside the launcher lock", async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "cca-current-"));
  const bin = join(directory, "bin");
  const registry = join(directory, "accounts.json");
  vi.stubEnv("CLAUDE_ACCOUNTS_BIN_DIR", bin);
  vi.stubEnv("CLAUDE_ACCOUNTS_FILE", registry);
  await fs.writeFile(registry, "[]");
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const held = withFileLock(join(bin, ".cc-accounts-sync"), async () => {
    acquired();
    await new Promise<void>(resolve => { release = resolve; });
  });
  await ready;
  const syncing = syncCurrent();
  await fs.writeFile(registry, JSON.stringify([{ slug: "fresh", label: "Fresh", service: "fixture" }]));
  release();
  await held;
  await syncing;
  const suffix = process.platform === "win32" ? ".cmd" : "";
  expect(await fs.readFile(join(bin, `claude-fresh${suffix}`), "utf8")).toContain("cc-accounts launcher");
});
