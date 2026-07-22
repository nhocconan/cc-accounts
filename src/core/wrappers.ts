// Keeps the per-account claude-<slug> launchers in sync with the registry.
// Each launcher is a symlink to the cca binary, which dispatches on its own
// basename (busybox-style): invoked as claude-work, it launches that account.
// Stale links for removed accounts are pruned. We only ever touch symlinks that
// point at the cca binary, so we never clobber an unrelated command of the same
// name.
import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Account } from "./registry.ts";
import { command } from "./registry.ts";
import { defaultBinDir, resolveSelfBinary } from "./paths.ts";

export function wrappersDir(): string {
  return defaultBinDir();
}

async function self(): Promise<{ dir: string; target: string } | null> {
  // We symlink to the cca binary itself. Use the resolved absolute path.
  const exe = resolveSelfBinary();
  if (!exe) return null;
  return { dir: wrappersDir(), target: exe };
}

/** The basename of the self binary (e.g. "cca" or "cli.js"). */
function selfName(target: string): string {
  return basename(target);
}

/**
 * Ensure a claude-<slug> symlink exists for every account and remove our stale
 * links. Only touches symlinks that resolve to the cca binary.
 */
export async function sync(accounts: Account[]): Promise<void> {
  const me = await self();
  if (!me) return;
  const { dir, target } = me;

  await fs.mkdir(dir, { recursive: true }).catch(() => {});

  const valid = new Set<string>();
  for (const acct of accounts) {
    const name = command(acct);
    valid.add(name);
    await ensureLink(join(dir, name), target);
  }

  // Prune stale claude-* links that point at us but aren't for a current account.
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (!name.startsWith("claude-") || name === selfName(target) || valid.has(name)) continue;
    const link = join(dir, name);
    if (await isOurLink(link, target)) {
      await fs.unlink(link).catch(() => {});
    }
  }
}

async function ensureLink(link: string, target: string): Promise<void> {
  try {
    const st = await fs.lstat(link);
    if (st.isSymbolicLink()) {
      const existing = await fs.readlink(link).catch(() => "");
      // Already correctly linked? Nothing to do.
      if (existing === target) return;
      // Points elsewhere — leave it (don't clobber a user's own claude-foo).
      return;
    }
    // A real file/dir already exists here. Leave it alone.
    return;
  } catch {
    /* doesn't exist — create below */
  }
  try {
    await fs.symlink(target, link);
  } catch {
    /* best-effort */
  }
}

async function isOurLink(link: string, target: string): Promise<boolean> {
  try {
    const st = await fs.lstat(link);
    if (!st.isSymbolicLink()) return false;
    const t = await fs.readlink(link).catch(() => "");
    return t === target;
  } catch {
    return false;
  }
}
