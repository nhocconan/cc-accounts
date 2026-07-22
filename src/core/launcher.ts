// Launches Claude Code authenticated as a chosen account and isolated to its
// own config dir. Spawns claude as a child with inherited stdio and relays
// signals so Ctrl-C, etc. behave correctly.
import { spawn } from "node:child_process";
import { resolveClaudeBin } from "./paths.ts";
import * as credstore from "./credstore.ts";
import { build } from "./isolation.ts";
import { writeStatusSettings } from "./settings.ts";
import { fiveHourNearLimit } from "./usage.ts";
import type { Account } from "./registry.ts";

/**
 * Auth vars that compete with the injected token — scrubbed so subprocesses,
 * hooks, and MCP servers can't accidentally inherit a different account's auth.
 */
const SCRUB_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

export interface LaunchResult {
  code: number;
}

/**
 * Start claude as the given account. Throws if the token is missing; otherwise
 * resolves with claude's exit code.
 */
export async function launch(acct: Account, args: string[]): Promise<LaunchResult> {
  const token = await credstore.get(acct.service);
  if (!token) {
    process.stderr.write(
      `No token found for ${acct.label}.\nRun: cca   (then choose Add or Refresh)\n`,
    );
    throw new Error(`no token for ${acct.slug}`);
  }

  let configDir = "";
  try {
    configDir = await build(acct);
  } catch (err) {
    process.stderr.write(
      `warning: account isolation failed (${err}); launching unisolated\n`,
    );
  }

  const near = await fiveHourNearLimit(acct.slug, 85, Date.now() / 1000);
  if (near.ok) {
    process.stderr.write(
      `Note: this account was at ${Math.round(near.pct)}% of its 5-hour limit recently.\n`,
    );
  }

  const bin = resolveClaudeBin();
  const argv = [bin];
  const statusSettings = await writeStatusSettings().catch(() => "");
  if (statusSettings) argv.push("--settings", statusSettings);

  // Optionally name the session after the account (surfaces in resume picker +
  // terminal title). Opt-in; off by default to avoid clobbering Claude's names.
  if (process.env.CLAUDE_ACCOUNTS_NAME_SESSIONS && !hasExplicitName(args)) {
    argv.push("--name", acct.label);
  }
  argv.push(...args);

  process.stderr.write(`Starting Claude with account: ${acct.label}\n`);

  const child = spawn(argv[0]!, argv.slice(1), {
    stdio: "inherit",
    env: buildEnv(token, acct, configDir),
    windowsHide: false,
  });

  // Relay signals to the child so Ctrl-C/SIGTERM behave as expected.
  const relay = (sig: NodeJS.Signals) => child.kill(sig);
  process.on("SIGINT", relay);
  process.on("SIGTERM", relay);
  process.on("SIGHUP", relay);

  return await new Promise<LaunchResult>((resolve) => {
    child.on("exit", (code, signal) => {
      process.off("SIGINT", relay);
      process.off("SIGTERM", relay);
      process.off("SIGHUP", relay);
      if (signal && code === null) {
        // Mirror the signal: die the same way our child did.
        process.kill(process.pid, signal);
      }
      resolve({ code: code ?? 1 });
    });
  });
}

function buildEnv(token: string, acct: Account, configDir: string): NodeJS.ProcessEnv {
  const skip = new Set<string>([
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_ACCOUNTS_SLUG",
    "CLAUDE_ACCOUNTS_LABEL",
    "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB",
    ...SCRUB_VARS,
  ]);
  if (configDir) skip.add("CLAUDE_CONFIG_DIR");

  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (skip.has(k)) continue;
    env[k] = v;
  }
  env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = "1";
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  env.CLAUDE_ACCOUNTS_SLUG = acct.slug;
  env.CLAUDE_ACCOUNTS_LABEL = acct.label;
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  return env;
}

/** A --name/--name=/-n before any "--" means the user named the session. */
function hasExplicitName(args: string[]): boolean {
  for (const a of args) {
    if (a === "--") return false;
    if (a === "--name" || a === "-n" || a.startsWith("--name=")) return true;
    if (a.startsWith("-n") && a.length > 2) return true;
  }
  return false;
}
