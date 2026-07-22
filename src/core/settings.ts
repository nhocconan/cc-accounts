// Settings merging — the "Hybrid" isolation feature. Each account's config dir
// gets a settings.json that is the user's base settings (~/.claude/settings.json)
// DEEP-MERGED with any per-account overrides (model, env, etc.), plus a
// statusLine hook so the active account name + usage shows in-session.
//
// If an account has no overrides, the settings.json is just the base (shared via
// symlink) with the statusLine hook layered on via the launcher's --settings.
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { claudeHome, configRoot } from "./paths.ts";
import type { Account } from "./registry.ts";
import { resolveSelfBinary } from "./paths.ts";

/** Read and parse the base ~/.claude/settings.json (or {} if absent/invalid). */
export async function readBaseSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(join(claudeHome(), "settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Deep-merge b onto a (b wins). Returns a new object; inputs are not mutated. */
export function deepMerge<T = Record<string, unknown>>(a: unknown, b: unknown): T {
  if (typeof a !== "object" || a === null || Array.isArray(a)) return (b ?? a) as T;
  if (typeof b !== "object" || b === null || Array.isArray(b)) return (b ?? a) as T;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    out[k] = deepMerge((a as Record<string, unknown>)[k], v);
  }
  return out as T;
}

/**
 * Build the statusLine settings file (one global file — the statusline binary
 * reads CLAUDE_ACCOUNTS_SLUG/LABEL from env at render time). Returns its path.
 */
export async function writeStatusSettings(): Promise<string> {
  await fs.mkdir(configRoot(), { recursive: true, mode: 0o700 });
  const path = join(configRoot(), "status-settings.json");
  const exe = resolveSelfBinary();
  const body = {
    statusLine: {
      type: "command",
      command: `${shellQuote(exe)} statusline`,
      padding: 0,
    },
  };
  await atomicWrite(path, JSON.stringify(body, null, 2));
  return path;
}

/**
 * Write the per-account settings.json into acctDir: base settings deep-merged
 * with account overrides. (The statusLine hook is applied at launch time via
 * the global --settings file, not baked in here — so the same settings.json
 * stays valid if the install path moves.)
 */
export async function writeMergedSettings(acct: Account, acctDir: string): Promise<void> {
  const base = await readBaseSettings();
  const overrides = acct.overrides?.settings ?? {};
  const merged = deepMerge(base, overrides);
  // Only write a settings.json if we have something to say (otherwise the
  // symlinked base settings.json is fine on its own).
  if (Object.keys(merged).length === 0) return;
  await atomicWrite(join(acctDir, "settings.json"), JSON.stringify(merged, null, 2));
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + ".tmp";
  await fs.writeFile(tmp, content, { mode: 0o600 });
  await fs.rename(tmp, path);
}

/** Single-quote a path for safe inclusion in a shell command. */
export function shellQuote(s: string): string {
  return "'" + s.replaceAll("'", `'"'"'`) + "'";
}
