// Cached per-account rate-limit snapshots. The statusline command captures the
// rate_limits JSON Claude prints on stdin each tick and writes it here; this
// module reads those snapshots for `list`, `doctor`, and the near-limit warning.
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { usageDir } from "./paths.ts";

export interface Window {
  used_percentage?: number | null;
  resets_at?: number | null;
}

interface Snapshot {
  rate_limits?: {
    five_hour?: Window;
    seven_day?: Window;
  };
  captured_at?: number;
}

async function load(slug: string): Promise<Snapshot | null> {
  try {
    const raw = await fs.readFile(join(usageDir(), `${slug}.json`), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return { ...parsed, rate_limits: sanitizeRateLimits(parsed.rate_limits) };
  } catch {
    return null;
  }
}

/** "5h X% · 7d Y% used", or "usage pending" when no data. */
export async function summary(slug: string): Promise<string> {
  const snap = await load(slug);
  if (!snap?.rate_limits) return "usage pending";

  const parts: string[] = [];
  const f = snap.rate_limits.five_hour;
  const d = snap.rate_limits.seven_day;
  if (f?.used_percentage != null) parts.push(`5h ${Math.round(f.used_percentage)}%`);
  if (d?.used_percentage != null) parts.push(`7d ${Math.round(d.used_percentage)}%`);
  if (parts.length === 0) return "usage pending";
  return parts.join(" · ") + " used";
}

/**
 * A stable signature of an account's usage, used to detect when two accounts
 * are actually billing the same subscription. Empty when no data.
 */
export async function fingerprint(slug: string): Promise<string> {
  const snap = await load(slug);
  if (!snap?.rate_limits) return "";
  const f = snap.rate_limits.five_hour;
  const d = snap.rate_limits.seven_day;
  if (f?.used_percentage == null && d?.used_percentage == null) return "";
  return [fstr(f?.used_percentage), istr(f?.resets_at), fstr(d?.used_percentage), istr(d?.resets_at)].join("|");
}

/**
 * Reports the 5-hour usage when its window is still active and at/above
 * threshold; otherwise ok=false. Used to warn before launching a near-limit acct.
 */
export async function fiveHourNearLimit(
  slug: string,
  threshold: number,
  now: number,
): Promise<{ pct: number; ok: true } | { ok: false }> {
  const snap = await load(slug);
  if (!snap?.rate_limits?.five_hour) return { ok: false };
  const f = snap.rate_limits.five_hour;
  if (f.used_percentage == null || f.resets_at == null) return { ok: false };
  if (f.resets_at <= now || f.used_percentage < threshold) return { ok: false };
  return { pct: f.used_percentage, ok: true };
}

function fstr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}
function istr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

/** Ignore malformed provider/cache values rather than showing fabricated meters. */
export function sanitizeRateLimits(value: unknown): Snapshot["rate_limits"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: NonNullable<Snapshot["rate_limits"]> = {};
  for (const key of ["five_hour", "seven_day"] as const) {
    const candidate = (value as Record<string, unknown>)[key];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const raw = candidate as Record<string, unknown>;
    const window: Window = {};
    if (typeof raw.used_percentage === "number" && Number.isFinite(raw.used_percentage) && raw.used_percentage >= 0 && raw.used_percentage <= 100) window.used_percentage = raw.used_percentage;
    if (typeof raw.resets_at === "number" && Number.isFinite(raw.resets_at) && raw.resets_at > 0) window.resets_at = raw.resets_at;
    result[key] = window;
  }
  return result;
}
