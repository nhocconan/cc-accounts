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
  if (header) process.stderr.write(header + "\n");
  labels.forEach((l, i) => process.stderr.write(`  ${i + 1}) ${l}\n`));
  process.stderr.write(`  0) Cancel\n${prompt}`);

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question("", (ans) => {
      rl.close();
      const n = parseInt((ans || "").trim(), 10);
      if (Number.isNaN(n) || n < 1 || n > labels.length) return resolve({ ok: false });
      return resolve({ index: n - 1, ok: true });
    });
  });
}

/** Read a single line from stdin (for prompts). Returns trimmed input. */
export async function promptLine(text: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  process.stderr.write(`${text}${suffix}: `);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question("", (ans) => {
      rl.close();
      const v = (ans || "").trim();
      resolve(v === "" && defaultValue !== undefined ? defaultValue : v);
    });
  });
}

/** Yes/no confirmation prompt. Returns true only for explicit y/yes. */
export async function confirm(text: string): Promise<boolean> {
  const ans = await promptLine(`${text} [y/N]`);
  return /^(y|yes)$/i.test(ans);
}
