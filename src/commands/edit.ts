// `cca edit <slug>` — change an account's label, slug, or settings overrides.
// Renaming the slug moves the token (Keychain service) and cached usage to the
// new key; the stale claude-<slug> launcher is pruned by the subsequent sync.
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  find,
  load,
  rewrite,
  serviceFor,
  slugify,
  validSlug,
  type Account,
  type AccountOverrides,
} from "../core/registry.ts";
import * as credstore from "../core/credstore.ts";
import { clearUsage } from "./util.ts";
import { usageDir } from "../core/paths.ts";
import { sync } from "../core/wrappers.ts";
import { promptLine, confirm } from "../ui/select.ts";

export interface EditOptions {
  name?: string;
  slug?: string;
  /** JSON string of settings overrides, or "clear" to remove overrides. */
  settings?: string;
}

export async function edit(slug: string, opts: EditOptions = {}): Promise<void> {
  const acct = await find(slug);
  if (!acct) throw new Error(`unknown account: ${slug}`);

  // Interactive prompts for anything not supplied via flags.
  const label = opts.name !== undefined ? opts.name : await promptLine("Display name", acct.label);
  if (/[\t\n]/.test(label)) throw new Error("display name must be free of tabs/newlines");

  let newSlug =
    opts.slug !== undefined ? opts.slug : await promptLine("Command suffix (without claude-)", acct.slug);
  if (newSlug) newSlug = newSlug.replace(/^claude-/, "");
  if (!newSlug || !validSlug(newSlug)) {
    throw new Error("suffix must use lowercase letters, numbers, and internal hyphens only");
  }

  // Overrides: parse JSON from --settings, or prompt to edit.
  let overrides: AccountOverrides | undefined = acct.overrides;
  if (opts.settings !== undefined) {
    if (opts.settings === "clear") {
      overrides = undefined;
    } else {
      try {
        overrides = { settings: JSON.parse(opts.settings) };
      } catch {
        throw new Error("--settings must be valid JSON (or 'clear')");
      }
    }
  }

  const next: Account = {
    slug: newSlug,
    label,
    service: newSlug === acct.slug ? acct.service : serviceFor(newSlug),
    createdAt: acct.createdAt,
  };
  if (overrides) next.overrides = overrides;

  // No-op short-circuit.
  if (
    newSlug === acct.slug &&
    label === acct.label &&
    JSON.stringify(overrides) === JSON.stringify(acct.overrides)
  ) {
    console.log("No changes.");
    return;
  }

  // If slug changed, move token + usage to the new key.
  if (newSlug !== acct.slug) {
    if (await find(newSlug)) throw new Error(`account ${newSlug} already exists`);
    const token = await credstore.get(acct.service);
    if (token) {
      await credstore.set(next.service, token);
      await credstore.del(acct.service).catch(() => {});
    }
    await fs
      .rename(join(usageDir(), `${acct.slug}.json`), join(usageDir(), `${newSlug}.json`))
      .catch(() => {});
  }

  await rewrite(acct.slug, next);
  await clearUsage(newSlug).catch(() => {});
  await sync(await load());
  console.log(`Updated ${label}. Launch with: claude-${newSlug}`);
}
