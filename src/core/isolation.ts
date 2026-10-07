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
import { randomUUID } from "node:crypto";
import { withFileLock } from "./lock.ts";
import { promises as fs, type Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { claudeHome, claudeJson, configDirFor } from "./paths.ts";
import { validSlug, type Account } from "./registry.ts";
import { writeMergedSettings } from "./settings.ts";

/**
 * Build (or refresh) the per-account config dir and return its path.
 * Rebuilds are idempotent and fast — symlinks are recreated, stale ones pruned.
 */
export async function build(acct: Account): Promise<string> {
  if (!validSlug(acct.slug)) throw new Error("invalid account slug");
  return withFileLock(configDirFor(acct.slug) + ".build", () => buildUnlocked(acct));
}

async function buildUnlocked(acct: Account): Promise<string> {
  const base = claudeHome();
  const acctDir = configDirFor(acct.slug);

  await fs.mkdir(acctDir, { recursive: true, mode: 0o700 });
  // A redirected account home must never write stripped identity/settings into
  // the user's base home or another account.
  if ((await fs.lstat(acctDir)).isSymbolicLink()) {
    throw new Error("account config directory must not be a symlink");
  }
  const baseReal = await fs.realpath(base).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined;
    throw err;
  });
  if (baseReal === await fs.realpath(acctDir)) {
    throw new Error("account config directory must differ from the base Claude directory");
  }

  // Settings are always regenerated as a real account file so clearing an
  // override cannot leave a stale merged value behind.
  await mirror(base, acctDir, new Set(["settings.json"]));
  await writeStripped(claudeJson(), join(acctDir, ".claude.json"));
  await writeMergedSettings(acct, acctDir);

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
  } catch (err) {
    // An absent base is normal; unreadable state must not silently disappear.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
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
      await fs.symlink(target, link, process.platform === "win32" && entry.isDirectory() ? "junction" : undefined);
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
  // Credentials and cached account metadata must never be shared, including
  // backups and temporary copies that can retain the base account identity.
  if (/^(?:\.credentials\.json|\.claude\.json)(?:[.-].+)?$/.test(name)) return true;
  if (name === "tmp" || name === ".tmp" || name.endsWith(".tmp")) return true;
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
  if (!top || typeof top !== "object" || Array.isArray(top)) {
    throw new Error(`${src} must contain a JSON object`);
  }
  delete top.oauthAccount;

  await safeWrite(dst, JSON.stringify(top, null, 2) + "\n");
}

/** Atomic 0600 write. */
async function safeWrite(path: string, content: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, content, { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, path);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
