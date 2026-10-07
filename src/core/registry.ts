// The account registry: a JSON file mapping slugs to metadata. It NEVER stores
// tokens — those live in the OS credential store (Keychain on macOS, a 0600
// file elsewhere), keyed by the `service` name recorded here.
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { withFileLock } from "./lock.ts";
import { accountsFile } from "./paths.ts";

export interface AccountOverrides {
  /** Per-account settings.json overrides (model, env, etc.) — merged on top of base. */
  settings?: Record<string, unknown>;
}

export interface Account {
  [key: string]: unknown;
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

export function validLabel(label: string): boolean {
  return label.length > 0 && !/[\u0000-\u001f\u007f]/.test(label);
}

/** Read and parse the registry. Missing file = empty list (not an error). */
export async function load(): Promise<Account[]> {
  try {
    const raw = await fs.readFile(accountsFile(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`${accountsFile()} must contain a JSON array`);
    const seen = new Set<string>();
    const out: Account[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const slug = typeof item.slug === "string" ? item.slug : "";
      const label = typeof item.label === "string" ? item.label : "";
      const service = typeof item.service === "string" ? item.service : "";
      if (!validSlug(slug) || !validLabel(label) || !service || seen.has(slug)) continue;
      seen.add(slug);
      const acct: Account = {
        ...item,
        slug,
        label,
        service,
        createdAt: String(item.createdAt ?? new Date().toISOString()),
      };
      if (item.overrides && typeof item.overrides === "object") {
        const overrides: AccountOverrides = { ...item.overrides };
        if (item.overrides.settings && typeof item.overrides.settings === "object" && !Array.isArray(item.overrides.settings)) {
          overrides.settings = item.overrides.settings as Record<string, unknown>;
        }
        acct.overrides = overrides;
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
  const tmp = `${accountsFile()}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(accounts, null, 2), { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, accountsFile());
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

export async function append(a: Account): Promise<void> {
  validateAccount(a);
  await withFileLock(accountsFile() + ".lock", async () => {
    const accounts = await load();
    if (accounts.some((x) => x.slug === a.slug)) throw new Error(`account ${a.slug} already exists`);
    accounts.push(a);
    await writeAll(accounts);
  });
}

export async function remove(slug: string): Promise<void> {
  await withFileLock(accountsFile() + ".lock", async () => {
    const accounts = await load();
    await writeAll(accounts.filter((x) => x.slug !== slug));
  });
}

/** Replace an existing entry without dropping fields written by newer versions. */
export async function rewrite(slug: string, next: Account): Promise<void> {
  validateAccount(next);
  await withFileLock(accountsFile() + ".lock", async () => {
    const accounts = await load();
    const index = accounts.findIndex((x) => x.slug === slug);
    if (index < 0) throw new Error(`unknown account: ${slug}`);
    if (next.slug !== slug && accounts.some((x) => x.slug === next.slug)) {
      throw new Error(`account ${next.slug} already exists`);
    }
    const merged = { ...accounts[index], ...next };
    if (!Object.prototype.hasOwnProperty.call(next, "overrides")) delete merged.overrides;
    accounts[index] = merged;
    await writeAll(accounts);
  });
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

function validateAccount(a: Account): void {
  if (!validSlug(a.slug) || !validLabel(a.label) || typeof a.service !== "string" || !a.service) {
    throw new Error("invalid account metadata");
  }
}
