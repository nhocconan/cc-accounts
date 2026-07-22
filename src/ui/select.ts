// Interactive chooser with three backends, zero runtime deps:
//   1. fzf if installed + a TTY (matches the reference tool's UX)
//   2. raw-mode arrow keys if stdin is a TTY (nice, no external dep)
//   3. numbered prompt fallback (works in any piped/CI context)
//
// Returns the chosen index, or ok=false when the user cancels (Esc/Ctrl-C/0).
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { isatty } from "node:tty";

const execFileP = promisify(execFile);

function ttyIn(): boolean {
  return typeof process.stdin.isTTY === "boolean" ? process.stdin.isTTY : isatty(0);
}
function ttyOut(): boolean {
  return typeof process.stdout.isTTY === "boolean" ? process.stdout.isTTY : isatty(1);
}

async function hasFzf(): Promise<boolean> {
  try {
    await execFileP("fzf", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export interface SelectOptions {
  prompt?: string;
  header?: string;
}

export async function select(
  labels: string[],
  opts: SelectOptions = {},
): Promise<{ index: number; ok: true } | { ok: false }> {
  if (labels.length === 0) return { ok: false };
  const prompt = opts.prompt ?? "> ";
  const header = opts.header ?? "";

  // fzf is nicest when available + interactive.
  if (ttyIn() && ttyOut() && (await hasFzf())) {
    const r = await fzfSelect(labels, prompt, header);
    if (r.ok) return r;
    // fzf was interrupted (Ctrl-C); don't fall through, just cancel.
    if (ttyIn()) return { ok: false };
  }

  if (ttyIn() && ttyOut()) {
    return arrowSelect(labels, prompt, header);
  }
  return numberedSelect(labels, prompt, header);
}

async function fzfSelect(
  labels: string[],
  prompt: string,
  header: string,
): Promise<{ index: number; ok: true } | { ok: false }> {
  const input = labels.map((l, i) => `${i}\t${l}`).join("\n") + "\n";
  const args = [
    `--prompt=${prompt}`,
    header ? `--header=${header}` : "",
    "--height=40%",
    "--layout=reverse",
    "--border",
    "--no-multi",
    "--delimiter=\t",
    "--with-nth=2..",
  ].filter(Boolean);
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn("fzf", args, { stdio: ["pipe", "pipe", "inherit"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`fzf exited ${code}`));
      });
      child.stdin.end(input);
    });
    const line = stdout.replace(/\r?\n$/, "");
    const idx = parseInt(line.split("\t")[0] ?? "-1", 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= labels.length) return { ok: false };
    return { index: idx, ok: true };
  } catch {
    return { ok: false };
  }
}

/** Raw-mode arrow-key menu. Renders the list and highlights the selection. */
async function arrowSelect(
  labels: string[],
  prompt: string,
  header: string,
): Promise<{ index: number; ok: true } | { ok: false }> {
  return new Promise((resolve) => {
    const out = process.stdout;
    let selected = 0;

    const render = () => {
      const lines: string[] = [];
      if (header) lines.push(`\x1b[2m${header}\x1b[0m`);
      labels.forEach((l, i) => {
        const marker = i === selected ? "\x1b[36m❯\x1b[0m " : "  ";
        const text = i === selected ? `\x1b[1;36m${l}\x1b[0m` : l;
        lines.push(`${marker}${text}`);
      });
      lines.push(`\x1b[2m(↑/↓ select, Enter confirm, Esc cancel)\x1b[0m ${prompt}`);
      out.write(`\x1b[2K\r\x1b[1A\x1b[2K`.repeat(0)); // no-op safety
      // Clear from cursor down, then print.
      out.write("\x1b[J");
      out.write(lines.join("\n") + "\n");
    };

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      // Erase the menu we drew.
      const lineCount = (header ? 1 : 0) + labels.length + 1;
      out.write(`\x1b[${lineCount}A\x1b[J`);
    };

    const onData = (buf: Buffer) => {
      const s = buf.toString();
      // Ctrl-C (0x03), Esc (0x1b alone), q
      if (s === "\x03" || s === "\x1b" || s === "q") {
        cleanup();
        resolve({ ok: false });
        return;
      }
      // Up: \x1b[A or k. Down: \x1b[B or j.
      if (s === "\x1b[A" || s === "k") {
        selected = (selected - 1 + labels.length) % labels.length;
        render();
      } else if (s === "\x1b[B" || s === "j") {
        selected = (selected + 1) % labels.length;
        render();
      } else if (s === "\r" || s === "\n") {
        const idx = selected;
        cleanup();
        resolve({ index: idx, ok: true });
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
    render();
  });
}

async function numberedSelect(
  labels: string[],
  prompt: string,
  header: string,
): Promise<{ index: number; ok: true } | { ok: false }> {
  if (header) process.stdout.write(header + "\n");
  labels.forEach((l, i) => process.stdout.write(`  ${i + 1}) ${l}\n`));
  process.stdout.write(`  0) Cancel\n${prompt}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("", (ans) => {
      rl.close();
      const n = parseInt((ans || "").trim(), 10);
      if (Number.isNaN(n) || n < 1 || n > labels.length) return resolve({ ok: false });
      return resolve({ index: n - 1, ok: true });
    });
  });
}

/**
 * Read a single line from stdin (for prompts). Returns trimmed input.
 *
 * The question is terminated with a newline before input is read, and only a
 * short "> " marker shares the cursor's line. npm/npx draw a progress spinner
 * that erases the current terminal line (\x1b[1G\x1b[0K) — it wipes whatever
 * sits on the cursor's line no matter which stream wrote it, so a trailing
 * "Name: " prompt vanished and `npx cc-accounts add` looked hung. A completed
 * line has already scrolled out of the spinner's reach.
 */
export function formatPrompt(text: string, defaultValue?: string): string {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  // MUST end in a newline — see the note above. A regression here makes the
  // CLI look frozen under npx.
  return `${text}${suffix}\n`;
}

export async function promptLine(text: string, defaultValue?: string): Promise<string> {
  requireInteractive(text);
  process.stdout.write(formatPrompt(text, defaultValue));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("> ", (ans) => {
      rl.close();
      const v = (ans || "").trim();
      resolve(v === "" && defaultValue !== undefined ? defaultValue : v);
    });
  });
}

/**
 * Fail loudly instead of blocking forever on a stdin that will never deliver a
 * line (piped, redirected from /dev/null, CI). Hanging on an invisible prompt
 * is the worst possible failure mode here.
 */
function requireInteractive(what: string): void {
  if (ttyIn()) return;
  throw new Error(
    `cannot prompt for "${what}" — stdin is not a terminal.\n` +
      "Run this in an interactive shell, or pass the values as flags:\n" +
      "  cca add --name <label> --slug <suffix> --token <sk-ant-oat…>",
  );
}

/** Pause until the user presses Enter, so browser flows never start unannounced. */
export async function pressEnter(text: string): Promise<void> {
  requireInteractive(text);
  process.stdout.write(`${text}\n`); // newline-terminated: see promptLine
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => rl.question("> ", () => (rl.close(), resolve())));
}

/** Yes/no confirmation prompt. Returns true only for explicit y/yes. */
export async function confirm(text: string): Promise<boolean> {
  const ans = await promptLine(`${text} [y/N]`);
  return /^(y|yes)$/i.test(ans);
}
