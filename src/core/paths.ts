// All on-disk path resolution. Mirrors the reference Go tool's env-override
// scheme so the two could interop, and so tests/heredoc installs can relocate
// the whole tree with a single env var.
//
// Layout (rooted at ConfigRoot, overridable via CLAUDE_ACCOUNTS_DIR):
//   accounts.json        registry of accounts — never holds tokens
//   configs/<slug>/      per-account CLAUDE_CONFIG_DIR (symlinks + stripped json)
//   usage/<slug>.json    cached rate_limits captured by the statusline
//   tokens.json          fallback credstore on Linux/Windows (0600); mac uses Keychain
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { accessSync, constants, realpathSync, statSync } from "node:fs";

function home(): string {
  return homedir() || process.env.HOME || "/tmp";
}

function envOr(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

/** Root config directory for cca's own data (not Claude's). */
export function configRoot(): string {
  const override = process.env.CLAUDE_ACCOUNTS_DIR;
  if (override) return override;
  const base = envOr("XDG_CONFIG_HOME", join(home(), ".config"));
  return join(base, "claude-accounts");
}

/** JSON registry of accounts (slug, label, service, createdAt, overrides). */
export function accountsFile(): string {
  return envOr("CLAUDE_ACCOUNTS_FILE", join(configRoot(), "accounts.json"));
}

/** Directory holding cached per-account rate-limit snapshots. */
export function usageDir(): string {
  return envOr("CLAUDE_ACCOUNTS_USAGE_DIR", join(configRoot(), "usage"));
}

/** Root for per-account CLAUDE_CONFIG_DIR trees. */
export function configsDir(): string {
  return envOr("CLAUDE_ACCOUNTS_CONFIG_DIR", join(configRoot(), "configs"));
}

/** Per-account config dir for a given slug. */
export function configDirFor(slug: string): string {
  return join(configsDir(), slug);
}

/** The base Claude config whose contents are shared into each account dir. */
export function claudeHome(): string {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  return join(home(), ".claude");
}

/** The base ~/.claude.json (the file that caches oauthAccount). */
export function claudeJson(): string {
  if (process.env.CLAUDE_CONFIG_DIR) return join(process.env.CLAUDE_CONFIG_DIR, ".claude.json");
  return join(home(), ".claude.json");
}

/**
 * Best-effort writable directory on PATH to install the claude-<slug> launchers
 * into. Honors CLAUDE_ACCOUNTS_BIN_DIR; otherwise prefers ~/.local/bin if it's
 * already on PATH and writable, else the first writable PATH entry, else
 * ~/.local/bin (and the caller warns the user to add it to PATH).
 */
export function defaultBinDir(): string {
  if (process.env.CLAUDE_ACCOUNTS_BIN_DIR) return process.env.CLAUDE_ACCOUNTS_BIN_DIR;

  const preferred = join(home(), ".local", "bin");
  const path = process.env.PATH || "";
  const dirs = path.split(delimiter);

  if (dirs.includes(preferred)) {
    try {
      if (statSync(preferred).isDirectory()) { accessSync(preferred, constants.W_OK); return preferred; }
    } catch {
      /* fall through */
    }
  }

  for (const dir of dirs) {
    if (!dir) continue;
    // Avoid system dirs we have no business writing to.
    if (process.platform === "win32"
      ? dir.toLowerCase().startsWith((process.env.SystemRoot || "C:\\Windows").toLowerCase())
      : /^\/(?:bin|sbin|usr(?:\/|$)|System(?:\/|$))/.test(dir)) continue;
    try {
      if (/[\\/](?:_npx|node_modules[\\/]\.bin)(?:[\\/]|$)/.test(dir)) continue;
      if (statSync(dir).isDirectory()) { accessSync(dir, constants.W_OK); return dir; }
    } catch {
      /* try next */
    }
  }
  return preferred;
}

/**
 * Resolve the path to the installed `cca` binary — the symlink target for the
 * per-account launchers. Uses npm's baked-in npm_execpath / process.argv hint
 * first, falling back to `which cca`-style PATH lookup.
 */
export function resolveSelfBinary(): string {
  const arg = process.argv[1];
  if (arg) {
    try { return realpathSync(resolve(arg)); } catch { return resolve(arg); }
  }
  return "cca";
}

function executable(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch { return false; }
}

/** Locate Claude, rejecting a manager alias that would recursively relaunch. */
export function resolveClaudeBin(): string {
  const self = resolveSelfBinary();
  const valid = (candidate: string): boolean => {
    if (!executable(candidate)) return false;
    try { return realpathSync(candidate) !== self; } catch { return false; }
  };
  const explicit = process.env.CLAUDE_ACCOUNTS_CLAUDE_BIN;
  if (explicit) {
    if (!valid(explicit)) throw new Error(`Claude executable is unavailable or points at cca: ${explicit}`);
    return explicit;
  }
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];
  for (const dir of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (valid(candidate)) return candidate;
    }
  }
  const fallback = join(home(), ".local", "bin", "claude");
  if (valid(fallback)) return fallback;
  throw new Error("Claude executable not found. Install Claude Code or set CLAUDE_ACCOUNTS_CLAUDE_BIN.");
}
