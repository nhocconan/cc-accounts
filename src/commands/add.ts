// `cca add` — register a new account. Runs `claude setup-token` (with competing
// auth scrubbed so it uses the browser flow), stores the resulting token in the
// credential store, and appends to the registry. Supports headless add via
// --token or CLAUDE_CODE_OAUTH_TOKEN when a TTY isn't available.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  // `claude setup-token` prints the token inside a full-screen TUI and wipes the
  // screen on exit, so by the time we could prompt for a paste the token is
  // usually gone. Run it under `script`, which hands the child a real pty (the
  // TUI and browser flow still work) while teeing every byte to a file we can
  // scrape. Manual paste stays as the fallback.
  const dir = mkdtempSync(join(tmpdir(), "cca-"));
  const capture = join(dir, "setup-token.log");
  try {
    const captured = await spawnWithCapture(bin, capture);
    if (captured) {
      const token = extractToken(readFileSync(capture, "utf8"));
      if (token) {
        process.stderr.write(`\nCaptured token ${maskToken(token)} from setup-token.\n`);
        return token;
      }
      process.stderr.write("\nCould not read the token off the screen — paste it below.\n");
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await promptLine("Paste the generated token");
      if (token) return token;
      process.stderr.write("Nothing pasted. Scroll up for the sk-ant-oat… line, or Ctrl-C to abort.\n");
    }
    throw new Error("no token supplied; nothing was stored");
  } finally {
    // The capture holds a live credential; never leave it on disk.
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run `claude setup-token` with its output teed to `logPath`. Returns true if
 * the log is usable. Falls back to a plain inherited spawn (no capture, so
 * false) when `script` is unavailable, e.g. a stripped-down container.
 */
async function spawnWithCapture(bin: string, logPath: string): Promise<boolean> {
  const env = scrubbedEnv();
  // BSD/macOS: script [-q] file cmd args...   util-linux: script [-q] -c "cmd" file
  const variants: Array<{ cmd: string; args: string[]; capture: boolean }> = [
    { cmd: "script", args: ["-q", logPath, bin, "setup-token"], capture: true },
    { cmd: "script", args: ["-q", "-c", `${bin} setup-token`, logPath], capture: true },
    { cmd: bin, args: ["setup-token"], capture: false },
  ];

  let lastErr: Error | undefined;
  for (const v of variants) {
    try {
      const code = await new Promise<number>((resolve, reject) => {
        const child = spawn(v.cmd, v.args, { stdio: "inherit", env });
        child.on("exit", (c) => resolve(c ?? 1));
        child.on("error", reject);
      });
      if (code === 0) return v.capture;
      lastErr = new Error(`setup-token exited ${code}`);
      // A non-zero exit from `script` may mean the wrong flavor; try the next.
      if (!v.capture) throw lastErr;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error("setup-token failed");
}

/** Drop ANSI/OSC escape sequences so wrapped TUI output can be read as text. */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "") // OSC (hyperlinks)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/\x1b[()][A-Za-z0-9]/g, "")
    .replace(/\x1b./g, "");
}

/** A run of text sharing one active SGR foreground color ("" = default). */
interface ColorRun {
  color: string;
  text: string;
}

/**
 * Split raw terminal bytes into runs of text tagged with the active SGR color,
 * dropping every other escape sequence (cursor motion, erases, OSC links).
 */
function colorRuns(raw: string): ColorRun[] {
  const runs: ColorRun[] = [];
  const re = /\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b\[([0-9;?]*)([ -/]*[@-~])|\x1b[()][A-Za-z0-9]|\x1b./g;
  let color = "";
  let buf = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    buf += raw.slice(last, m.index);
    last = re.lastIndex;
    if (m[2] !== "m") continue; // not SGR — cursor motion etc. stays inside the run
    runs.push({ color, text: buf });
    buf = "";
    const p = m[1] ?? "";
    if (p === "" || p === "0" || p === "39") color = ""; // reset / default fg
    else if (p.startsWith("38;") || /^(3[0-7]|9[0-7])$/.test(p)) color = p;
  }
  runs.push({ color, text: buf + raw.slice(last) });
  return runs;
}

/**
 * Pull an sk-ant-oat token out of raw terminal output.
 *
 * The TUI hard-wraps the token at terminal width, so it arrives as several
 * chunks separated by cursor moves and padding whitespace. Length-based
 * rejoining swallows the "Store this token securely." line that follows, so
 * key off color instead: the token is printed in one highlight color and the
 * surrounding prose is not. Collect adjacent runs sharing the token's color,
 * skipping whitespace-only runs, and stop at the first differently-colored
 * text. Falls back to the single whitespace-delimited chunk for uncolored
 * output.
 */
export function extractToken(raw: string): string | undefined {
  const runs = colorRuns(raw);
  const at = runs.findIndex((r) => r.text.includes("sk-ant-oat"));
  if (at < 0) return undefined;

  const first = runs[at]!;
  const color = first.color;
  let token = first.text.slice(first.text.indexOf("sk-ant-oat"));

  if (color !== "") {
    // Colored token: a same-color continuation is a wrap, anything else ends it.
    if (!/\s/.test(token.trim())) {
      for (let i = at + 1; i < runs.length; i++) {
        const run = runs[i]!;
        if (run.text.trim() === "") continue; // padding between wrapped lines
        if (run.color !== color) break;
        token += run.text;
      }
    }
  }

  token = token.split(/\s+/).filter(Boolean).join("");
  token = token.replace(/[^A-Za-z0-9_-]+$/, "");
  const m = /^sk-ant-oat[A-Za-z0-9_-]{20,}/.exec(token);
  return m ? m[0] : undefined;
}

function maskToken(t: string): string {
  return t.length > 18 ? `${t.slice(0, 14)}…${t.slice(-4)}` : "…";
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
