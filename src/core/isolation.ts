// THE BILLING-ISOLATION CORE.
//
// Why this exists: Claude Code pins the account/org cached in ~/.claude.json's
// "oauthAccount" key onto every API request. So merely injecting a different
// account's CLAUDE_CODE_OAUTH_TOKEN is NOT enough — Claude reads the cached
// org from disk and bills the wrong plan (403, then a silent fallback).
//
// The fix: give each account its own CLAUDE_CONFIG_DIR that symlinks EVERYTHING
// from the base ~/.claude (settings, plugins, skills, agents, memory, history —
// all shared so nothing is reconfigured), but writes its own .claude.json with
// "oauthAccount" stripped. With no cached org, Claude falls back to the org
// encoded in the injected OAuth token → correct billing.
//
// We rebuild this dir on every launch so it always reflects current base
// settings and per-account overrides. The symlink refresh is cheap.
import { promises as fs, type Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { claudeHome, claudeJson, configDirFor } from "./paths.ts";
import type { Account } from "./registry.ts";
import { writeMergedSettings } from "./settings.ts";

/**
 * Build (or refresh) the per-account config dir and return its path.
 * Rebuilds are idempotent and fast — symlinks are recreated, stale ones pruned.
 */
export async function build(acct: Account): Promise<string> {
  const base = claudeHome();
  const acctDir = configDirFor(acct.slug);

  await fs.mkdir(acctDir, { recursive: true, mode: 0o700 });

  // If the account has settings overrides, settings.json must be a real merged
  // file (not a symlink to base), so don't symlink it.
  const hasOverrides = Object.keys(acct.overrides?.settings ?? {}).length > 0;
  const extraSkip = hasOverrides ? new Set(["settings.json"]) : new Set<string>();

  await mirror(base, acctDir, extraSkip);
  await writeStripped(claudeJson(), join(acctDir, ".claude.json"));
  if (hasOverrides) {
    await writeMergedSettings(acct, acctDir);
  }

  return acctDir;
}

/**
 * Symlink every entry of base into acctDir (share-by-default), EXCEPT:
 *  - .claude.json (regenerated separately with oauthAccount stripped)
 *  - names in extraSkip (e.g. settings.json when an account has overrides)
 *  - per-process runtime that must stay isolated (daemon*, *.lock, *.sock)
 * Stale symlinks whose source disappeared are pruned; real files Claude created
 * in acctDir are never touched.
 */
async function mirror(base: string, acctDir: string, extraSkip: Set<string>): Promise<void> {
  const want = new Set<string>();

  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    // Base ~/.claude may not exist yet (never logged in directly). Nothing to share.
    return;
  }

  for (const entry of entries) {
    const name = entry.name;
    if (name === ".claude.json" || isolatedName(name) || extraSkip.has(name)) continue;
    want.add(name);

    const link = join(acctDir, name);
    const target = join(base, name);

    // Refresh the symlink: remove any existing entry at `link` then recreate.
    // We only clobber if it's our symlink (not a real file/dir Claude made).
    try {
      const st = await fs.lstat(link);
      if (st.isSymbolicLink()) {
        await fs.unlink(link);
      } else {
        // A real file/dir already exists here (Claude created it locally).
        // Leave it — it's the account's own data, not ours to overwrite.
        continue;
      }
    } catch {
      /* doesn't exist — good, we'll create it */
    }

    try {
      await fs.symlink(target, link);
    } catch {
      /* best-effort: a failed symlink just means that bit isn't shared */
    }
  }

  // Prune our stale symlinks in acctDir whose source is gone from base.
  let acctEntries: Dirent[] = [];
  try {
    acctEntries = await fs.readdir(acctDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of acctEntries) {
    const name = entry.name;
    if (name === ".claude.json" || want.has(name)) continue;
    const full = join(acctDir, name);
    try {
      const st = await fs.lstat(full);
      if (st.isSymbolicLink()) {
        await fs.unlink(full);
      }
    } catch {
      /* skip */
    }
  }
}

/** Runtime files that must NOT be shared between accounts (per-process state). */
export function isolatedName(name: string): boolean {
  if (name === "daemon" || name.startsWith("daemon.")) return true;
  if (name.endsWith(".lock") || name.endsWith(".sock")) return true;
  return false;
}

/**
 * Copy src .claude.json to dst with the top-level "oauthAccount" key REMOVED.
 * Every other value is preserved byte-for-byte (we round-trip through JSON,
 * which preserves all value types — floats, nulls, nested structures).
 */
export async function writeStripped(src: string, dst: string): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(src);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Never logged in directly: nothing to strip, no account to leak.
      await safeWrite(dst, "{}\n");
      return;
    }
    throw err;
  }

  const top = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  delete top.oauthAccount;

  await safeWrite(dst, JSON.stringify(top, null, 2) + "\n");
}

/** Atomic 0600 write. */
async function safeWrite(path: string, content: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + ".tmp";
  await fs.writeFile(tmp, content, { mode: 0o600 });
  await fs.rename(tmp, path);
}
