// The `cca statusline` command: invoked BY Claude Code as its status line. Reads
// the status JSON Claude prints on stdin, renders the active account name (so a
// session always shows which login it uses) plus live usage, and caches the
// rate_limits for `list`/`doctor`. Pure Node — no shell dependency.
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { usageDir } from "../core/paths.ts";

interface Window {
  used_percentage?: number | null;
}

interface Payload {
  rate_limits?: {
    five_hour?: Window;
    seven_day?: Window;
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function run(): Promise<void> {
  const label = process.env.CLAUDE_ACCOUNTS_LABEL || "";
  const slug = process.env.CLAUDE_ACCOUNTS_SLUG || "";
  const display = label || slug;
  if (!display) return; // not launched through cca

  const raw = await readStdin();
  let payload: Payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    /* Claude occasionally emits partial JSON; render label only */
  }

  if (slug && validSlug(slug)) {
    await cacheUsage(slug, raw).catch(() => {});
  }

  let out = display;
  if (payload.rate_limits) {
    const parts: string[] = [];
    const f = payload.rate_limits.five_hour;
    const d = payload.rate_limits.seven_day;
    if (f?.used_percentage != null) parts.push(`5h ${Math.round(f.used_percentage)}%`);
    if (d?.used_percentage != null) parts.push(`7d ${Math.round(d.used_percentage)}%`);
    if (parts.length > 0) out += "  ·  " + parts.join(" · ");
  }
  process.stdout.write(out);
}

function validSlug(s: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

/** Extract rate_limits and cache the per-account snapshot read by list/doctor. */
async function cacheUsage(slug: string, data: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }
  const rl = (parsed as { rate_limits?: unknown }).rate_limits;
  if (!rl) return;

  const dir = usageDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const body = JSON.stringify({ captured_at: Date.now(), rate_limits: rl });
  const tmp = join(dir, `${slug}.json.tmp`);
  await fs.writeFile(tmp, body, { mode: 0o600 });
  await fs.rename(tmp, join(dir, `${slug}.json`));
}
