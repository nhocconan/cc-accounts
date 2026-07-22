// `cca add` — register a new account. Runs `claude setup-token` (with competing
// auth scrubbed so it uses the browser flow), stores the resulting token in the
// credential store, and appends to the registry. Supports headless add via
// --token or CLAUDE_CODE_OAUTH_TOKEN when a TTY isn't available.
import { spawn } from "node:child_process";
import {
  append,
  find,
  load,
  serviceFor,
  slugify,
  validSlug,
  type Account,
  type AccountOverrides,
} from "../core/registry.ts";
import * as credstore from "../core/credstore.ts";
import { clearUsage } from "./util.ts";
import { resolveClaudeBin } from "../core/paths.ts";
import { sync } from "../core/wrappers.ts";
import { promptLine } from "../ui/select.ts";

export interface AddOptions {
  /** Skip prompts; use these values. */
  name?: string;
  slug?: string;
  /** Token supplied directly (headless). If absent, run claude setup-token. */
  token?: string;
  /** JSON string of settings overrides to bake into the account. */
  settings?: string;
}

export async function add(opts: AddOptions = {}): Promise<void> {
  let name = opts.name;
  if (!name) name = await promptLine("Account display name");
  if (!name || /[\t\n]/.test(name)) {
    throw new Error("display name must be non-empty and free of tabs/newlines");
  }

  let slug = opts.slug;
  if (!slug) {
    const suggested = slugify(name);
    slug = await promptLine("Command suffix (without claude-)", suggested);
  }
  if (slug) slug = slug.replace(/^claude-/, "");
  if (!slug || !validSlug(slug)) {
    throw new Error("suffix must use lowercase letters, numbers, and internal hyphens only");
  }
  if (await find(slug)) {
    throw new Error(`account ${slug} already exists — use: cca refresh ${slug}`);
  }

  const service = serviceFor(slug);
  let token = opts.token;
  if (!token) {
    // Prefer an already-set env var for headless convenience, else run setup-token.
    token = process.env.CLAUDE_CODE_OAUTH_TOKEN || (await runSetupToken(name));
  }
  validateToken(token);

  await credstore.set(service, token);
  const acct: Account = { slug, label: name, service, createdAt: new Date().toISOString() };
  if (opts.settings) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(opts.settings);
    } catch {
      throw new Error("--settings must be valid JSON");
    }
    if (parsed && typeof parsed === "object") {
      const overrides: AccountOverrides = {};
      overrides.settings = parsed as Record<string, unknown>;
      acct.overrides = overrides;
    }
  }
  await append(acct);
  await clearUsage(slug);
  const others = (await load()).filter((x) => x.slug !== slug);
  await sync([acct, ...others]);

  console.log(`Stored ${name}. Launch with: claude-${slug}`);
}

async function runSetupToken(label: string): Promise<string> {
  process.stderr.write(`Generating a one-year OAuth token for ${label}.\n`);
  process.stderr.write("The token is bound to whichever account is signed in on claude.ai.\n");
  process.stderr.write("Switch to the intended account on claude.ai first.\n\n");

  const bin = resolveClaudeBin();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ["setup-token"], { stdio: "inherit", env: scrubbedEnv() });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`setup-token exited ${code}`))));
    child.on("error", reject);
  });

  const token = await promptLine("Paste the generated token");
  if (!token) throw new Error("no token supplied; nothing was stored");
  return token;
}

export function validateToken(token: string): void {
  if (!token) throw new Error("no token supplied; nothing was stored");
  if (!token.startsWith("sk-ant-oat")) {
    throw new Error(
      "that does not look like a Claude OAuth token (expected sk-ant-oat…); nothing was stored",
    );
  }
}

export function scrubbedEnv(): NodeJS.ProcessEnv {
  const skip = new Set([
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ]);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (skip.has(k)) continue;
    env[k] = v;
  }
  return env;
}
