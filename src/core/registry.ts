// The account registry: a JSON file mapping slugs to metadata. It NEVER stores
// tokens — those live in the OS credential store (Keychain on macOS, a 0600
// file elsewhere), keyed by the `service` name recorded here.
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { accountsFile } from "./paths.ts";

export interface AccountOverrides {
  /** Per-account settings.json overrides (model, env, etc.) — merged on top of base. */
  settings?: Record<string, unknown>;
}

export interface Account {
  slug: string;
  label: string;
  /** Keychain service name (or tokens.json key) under which the token is stored. */
  service: string;
  createdAt: string;
  overrides?: AccountOverrides;
}

/** The launcher command name for an account, e.g. claude-work. */
export function command(a: Account): string {
  return "claude-" + a.slug;
}

/** Keychain service name used for a slug's token. */
export function serviceFor(slug: string): string {
  return `Claude Accounts: claude-${slug}`;
}

/** Matches the reference tool's slug rules: [a-z0-9-], no leading/trailing -. */
export function validSlug(s: string): boolean {
  if (!s || s.startsWith("-") || s.endsWith("-")) return false;
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

/** Read and parse the registry. Missing file = empty list (not an error). */
export async function load(): Promise<Account[]> {
  try {
    const raw = await fs.readFile(accountsFile(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: Account[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const slug = String(item.slug ?? "");
      const label = String(item.label ?? "");
      const service = String(item.service ?? "");
      if (!validSlug(slug) || !label || !service || seen.has(slug)) continue;
      seen.add(slug);
      const acct: Account = {
        slug,
        label,
        service,
        createdAt: String(item.createdAt ?? new Date().toISOString()),
      };
      if (item.overrides && typeof item.overrides === "object") {
        acct.overrides = {};
        if (item.overrides.settings && typeof item.overrides.settings === "object") {
          acct.overrides.settings = item.overrides.settings as Record<string, unknown>;
        }
      }
      out.push(acct);
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function find(slug: string): Promise<Account | undefined> {
  return (await load()).find((a) => a.slug === slug);
}

/** Atomically write the full registry (used by append/remove/rewrite). */
async function writeAll(accounts: Account[]): Promise<void> {
  await fs.mkdir(dirname(accountsFile()), { recursive: true, mode: 0o700 });
  const tmp = accountsFile() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  await fs.rename(tmp, accountsFile());
}

export async function append(a: Account): Promise<void> {
  const accounts = await load();
  const without = accounts.filter((x) => x.slug !== a.slug);
  without.push(a);
  await writeAll(without);
}

export async function remove(slug: string): Promise<void> {
  const accounts = await load();
  await writeAll(accounts.filter((x) => x.slug !== slug));
}

/** Replace a slug's entry (or insert if new). Preserves ordering of others. */
export async function rewrite(slug: string, next: Account): Promise<void> {
  const accounts = await load();
  const out = accounts.map((x) => (x.slug === slug ? next : x));
  if (!out.some((x) => x.slug === next.slug)) out.push(next);
  await writeAll(out);
}

/** Derive a command suffix from a display name: lowercase, hyphen-collapsed. */
export function slugify(label: string): string {
  let s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.startsWith("claude-")) s = s.slice("claude-".length);
  return s;
}
