// `cca remove <slug>` — delete an account's token and registry entry.
import { find, load, remove as registryRemove } from "../core/registry.ts";
import * as credstore from "../core/credstore.ts";
import { clearUsage } from "./util.ts";
import { sync } from "../core/wrappers.ts";
import { confirm } from "../ui/select.ts";

export async function remove(slug: string): Promise<void> {
  const acct = await find(slug);
  if (!acct) throw new Error(`unknown account: ${slug}`);

  if (!(await confirm(`Remove ${acct.label} and its token?`))) {
    console.log("Kept.");
    return;
  }

  await credstore.del(acct.service).catch(() => {});
  await registryRemove(slug);
  await clearUsage(slug);
  // Prune the now-stale claude-<slug> launcher.
  await sync((await load()).filter((x) => x.slug !== slug));
  console.log(`Removed ${acct.label}.`);
}
