// Keeps durable per-account launchers in sync; only replaces project-owned
// scripts and legacy symlinks pointing at the manager.
import { existsSync, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import type { Account } from "./registry.ts";
import { command, load } from "./registry.ts";
import { defaultBinDir, resolveSelfBinary } from "./paths.ts";
import { withFileLock } from "./lock.ts";
import { VERSION } from "../version.ts";

export function wrappersDir(): string {
  return defaultBinDir();
}

async function self(): Promise<{ dir: string; target: string } | null> {
  // Record the resolved absolute manager entry point.
  const exe = resolveSelfBinary();
  if (!exe) return null;
  return { dir: wrappersDir(), target: exe };
}

/** Diagnostic retained for callers inspecting legacy symlink targets. */
export function warnIfTargetIsTransient(target: string): void {
  const ephemeral = /[\\/]_npx[\\/]|[\\/]\.npm[\\/]_cacache[\\/]/.test(target);
  const missing = !existsSync(target);
  if (!ephemeral && !missing) return;

  // An npx path that is also missing gets the npx wording: it is the more
  // specific diagnosis and points at the actual fix.
  const why = ephemeral
    ? `the launchers point into npx's temporary cache (${target}), which npm may delete`
    : `the launchers point at ${target}, which does not exist`;
  process.stderr.write(
    `\nwarning: ${why}.\n` +
      "  The claude-<slug> commands will stop working once it goes away.\n" +
      "  Install cca permanently so they keep resolving:\n" +
      "    npm install -g cc-accounts && cca sync\n\n",
  );
}

const MARKER = "cc-accounts launcher";


/** Durable launchers explicitly dispatch, preserving arguments after --. */
export function launcherContent(slug: string, target: string, windows = process.platform === "win32"): string {
  const transient = /[\\/]_npx[\\/]|[\\/]\.npm[\\/]_cacache[\\/]/.test(target) || target.endsWith(".ts") || !existsSync(target);
  if (windows) {
    // Percent expansion applies even inside cmd quotes; double literal percents.
    const quote = (value: string) => value.replace(/%/g, "%%").replace(/"/g, "");
    const recorded = transient ? "" : quote(target);
    return `@echo off\r
rem ${MARKER}\r
setlocal DisableDelayedExpansion\r
set "RECORDED_SELF=${recorded}"\r
if defined RECORDED_SELF if exist "%RECORDED_SELF%" goto recorded\r
for %%I in (cca.cmd cc-accounts.cmd cca.exe cc-accounts.exe) do if not "%%~$PATH:I"=="" (\r
  call "%%~$PATH:I" launch ${slug} -- %*\r
  goto done\r
)\r
call npx --prefix "%TEMP%" --yes --package=cc-accounts@${VERSION} cca launch ${slug} -- %*\r
goto done\r
:recorded\r
"${quote(process.execPath)}" "%RECORDED_SELF%" launch ${slug} -- %*\r
:done\r
exit /b %errorlevel%\r
`;
  }
  return `#!/usr/bin/env node
// ${MARKER}
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const recorded = ${transient ? "null" : JSON.stringify(target)};
let command = "npx";
let prefix = ["--prefix", os.tmpdir(), "--yes", "--package=cc-accounts@${VERSION}", "cca"];
if (recorded && fs.existsSync(recorded)) {
  command = process.execPath;
  prefix = [recorded];
} else {
  outer: for (const name of ["cca", "cc-accounts"]) {
    for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
      const candidate = path.join(dir, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.realpathSync(candidate) === fs.realpathSync(__filename)) continue;
        command = candidate;
        prefix = [];
        break outer;
      } catch {}
    }
  }
}
const child = spawn(command, [...prefix, "launch", ${JSON.stringify(slug)}, "--", ...process.argv.slice(2)], { stdio: "inherit" });
child.once("error", error => { console.error("Could not start cca:", error.message); process.exitCode = 1; });
child.once("exit", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
`;
}

/** Reload the registry after acquiring the launcher lock to avoid stale pruning. */
export async function syncCurrent(): Promise<void> {
  await syncSnapshot(load);
}

/** Explicit snapshots are intended for tests and controlled callers. */
export async function sync(accounts: Account[]): Promise<void> {
  await syncSnapshot(async () => accounts);
}

async function syncSnapshot(readAccounts: () => Promise<Account[]>): Promise<void> {
  const me = await self();
  if (!me) return;
  const { dir, target } = me;
  await withFileLock(join(dir, ".cc-accounts-sync"), async () => {
  const accounts = await readAccounts();
  const wanted = new Set<string>();
  for (const acct of accounts) {
    const name = command(acct) + (process.platform === "win32" ? ".cmd" : "");
    wanted.add(name);
    const destination = join(dir, name);
    if (!(await replaceable(destination, target))) continue;
    await writeLauncher(destination, launcherContent(acct.slug, target));
  }
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.name.startsWith("claude-") || wanted.has(entry.name) || entry.name === basename(target)) continue;
    const destination = join(dir, entry.name);
    if (await replaceable(destination, target)) await fs.unlink(destination);
  }
  });
}

async function writeLauncher(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { mode: 0o755, flag: "wx" });
    // Rename replaces an owned symlink itself, never its manager target.
    await fs.rename(temporary, path);
    if (process.platform !== "win32") await fs.chmod(path, 0o755);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

async function replaceable(path: string, target: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path);
    if (stat.isSymbolicLink()) return (await fs.readlink(path)) === target;
    if (!stat.isFile()) return false;
    return (await fs.readFile(path, "utf8")).includes(`// ${MARKER}`) ||
      (await fs.readFile(path, "utf8")).includes(`rem ${MARKER}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}
