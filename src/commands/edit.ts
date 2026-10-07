// `cca edit <slug>` — change an account's label, slug, or settings overrides.
// Renaming the slug moves the token (Keychain service) and private config, then
// clears cached usage; the stale claude-<slug> launcher is pruned by the subsequent sync.
import { promises as fs } from "node:fs";
import { configDirFor } from "../core/paths.ts";
import {
  find,
  rewrite,
  serviceFor,
  validSlug,
  type Account,
  type AccountOverrides,
} from "../core/registry.ts";
import * as credstore from "../core/credstore.ts";
import { parseSettings } from "../core/settings.ts";
import { withMutationLocks } from "../core/lock.ts";
import { clearUsage } from "./util.ts";
import { syncCurrent } from "../core/wrappers.ts";
import { promptLine } from "../ui/select.ts";

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
  if (!label.trim() || /[\x00-\x1f\x7f]/.test(label)) throw new Error("display name must be non-empty and free of control characters");

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
        overrides = { settings: parseSettings(opts.settings) };
      } catch {
        throw new Error("--settings must be a JSON object (or 'clear')");
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

  await withMutationLocks([slug, newSlug], async () => {
    const current = await find(slug);
    if (!current || JSON.stringify(current) !== JSON.stringify(acct)) {
      throw new Error("account changed during editing; retry cca edit");
    }
    let previous: string | null | undefined;
    let copied = false;
    let movedConfig = false;
    const sourceConfig = configDirFor(acct.slug);
    const destinationConfig = configDirFor(newSlug);
    let hasSourceConfig = false;
    if (newSlug !== acct.slug) {
      if (await find(newSlug)) throw new Error(`account ${newSlug} already exists`);
      try {
        await fs.lstat(destinationConfig);
        throw new Error(`config directory for ${newSlug} already exists; choose another suffix`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        const source = await fs.lstat(sourceConfig);
        if (!source.isDirectory() || source.isSymbolicLink()) {
          throw new Error("account config directory must be a real directory to rename");
        }
        hasSourceConfig = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      previous = await credstore.get(next.service);
      if (previous) throw new Error("destination credential already exists; choose another suffix");
      const token = await credstore.get(acct.service);
      if (token) { await credstore.set(next.service, token); copied = true; }
    }
    try {
      if (hasSourceConfig) {
        await fs.rename(sourceConfig, destinationConfig);
        movedConfig = true;
      }
      await rewrite(acct.slug, next);
    }
    catch (error) {
      const failures: unknown[] = [error];
      if (movedConfig) {
        try { await fs.rename(destinationConfig, sourceConfig); }
        catch (rollbackError) { failures.push(rollbackError); }
      }
      if (copied) {
        try {
          if (previous) await credstore.set(next.service, previous);
          else await credstore.del(next.service);
        } catch (rollbackError) { failures.push(rollbackError); }
      }
      if (failures.length > 1) throw new AggregateError(failures, "account rename failed; rollback needs attention");
      throw error;
    }
    if (newSlug !== acct.slug) {
      try { await credstore.del(acct.service); }
      catch (error) { console.error(`Account renamed; old credential cleanup failed: ${error}`); }
      await clearUsage(acct.slug);
    }
    await clearUsage(newSlug);
  });
  try { await syncCurrent(); }
  catch (error) { console.error(`Account saved, but launchers could not be synced: ${error}. Run: cca sync`); }
  console.log(`Updated ${label}. Launch with: claude-${newSlug}`);
}
