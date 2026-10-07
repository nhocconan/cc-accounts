// `cca remove <slug>` — delete an account's token and registry entry.
import { find, remove as registryRemove } from "../core/registry.ts";
import * as credstore from "../core/credstore.ts";
import { withMutationLock } from "../core/lock.ts";
import { clearUsage } from "./util.ts";
import { syncCurrent } from "../core/wrappers.ts";
import { confirm } from "../ui/select.ts";

export async function remove(slug: string): Promise<void> {
  const acct = await find(slug);
  if (!acct) throw new Error(`unknown account: ${slug}`);

  if (!(await confirm(`Remove ${acct.label} and its token?`))) {
    console.log("Kept.");
    return;
  }

  await withMutationLock(slug, async () => {
    const current = await find(slug);
    if (!current || JSON.stringify(current) !== JSON.stringify(acct)) throw new Error("account changed; retry cca remove");
    const token = await credstore.get(acct.service);
    await credstore.del(acct.service);
    try { await registryRemove(slug); }
    catch (error) {
      if (token) await credstore.set(acct.service, token);
      throw error;
    }
    await clearUsage(slug);
  });
  try { await syncCurrent(); }
  catch (error) { console.error(`Account removed, but launchers could not be synced: ${error}. Run: cca sync`); }
  console.log(`Removed ${acct.label}.`);
}
