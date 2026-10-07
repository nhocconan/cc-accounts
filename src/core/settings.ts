// Settings merging — the "Hybrid" isolation feature. Each account's config dir
// gets a settings.json that is the user's base settings (~/.claude/settings.json)
// DEEP-MERGED with any per-account overrides (model, env, etc.), plus a
// statusLine hook so the active account name + usage shows in-session.
//
// Every account receives regenerated settings with provider/auth variables
// removed; the statusLine hook is layered on through the launcher's --settings.
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { claudeHome, configRoot } from "./paths.ts";
import type { Account } from "./registry.ts";
import { resolveSelfBinary } from "./paths.ts";

/** Read base settings; only an absent file defaults to {}. */
export async function readBaseSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(join(claudeHome(), "settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("base settings.json must contain a JSON object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Deep-merge b onto a (b wins). Returns a new object; inputs are not mutated. */
export function deepMerge<T = Record<string, unknown>>(a: unknown, b: unknown): T {
  if (typeof a !== "object" || a === null || Array.isArray(a)) return (b ?? a) as T;
  if (typeof b !== "object" || b === null || Array.isArray(b)) return (b ?? a) as T;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    Object.defineProperty(out, k, { value: deepMerge(Object.hasOwn(a, k) ? (a as Record<string, unknown>)[k] : undefined, v), enumerable: true, writable: true, configurable: true });
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
      command: statuslineCommand(exe),
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
  const merged = deepMerge<Record<string, unknown>>(base, overrides);
  if (merged.env && typeof merged.env === "object" && !Array.isArray(merged.env)) {
    const blocked = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_ACCOUNTS_SLUG", "CLAUDE_ACCOUNTS_LABEL", "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB"]);
    merged.env = Object.fromEntries(Object.entries(merged.env).filter(([key]) => !blocked.has(key.toUpperCase())));
  }
  // Always replace managed settings, including when overrides were cleared.
  await atomicWrite(join(acctDir, "settings.json"), JSON.stringify(merged, null, 2));
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + `.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, content, { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, path);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

/** Single-quote a path for safe inclusion in a shell command. */
export function shellQuote(s: string): string {
  return "'" + s.replaceAll("'", `'"'"'`) + "'";
}

export function parseSettings(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("--settings must be a JSON object"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--settings must be a JSON object");
  return parsed as Record<string, unknown>;
}

/** Claude runs command hooks through the platform shell. */
export function statuslineCommand(exe: string, windows = process.platform === "win32"): string {
  if (windows) {
    if (/["%\r\n]/.test(exe)) throw new Error("statusline executable path contains unsupported shell characters");
    return `"${process.execPath}" "${exe}" statusline`;
  }
  return `${shellQuote(process.execPath)} ${shellQuote(exe)} statusline`;
}
