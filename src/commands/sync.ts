// `cca sync` — rebuild the per-account claude-<slug> launchers from the
// registry and refresh each account's isolated config dir. Safe to run anytime;
// it only touches symlinks that point at the cca binary.
import { load } from "../core/registry.ts";
import { syncCurrent as syncWrappers } from "../core/wrappers.ts";
import { build } from "../core/isolation.ts";

export async function sync(): Promise<void> {
  const accounts = await load();
  await syncWrappers();
  let refreshed = 0;
  for (const acct of accounts) {
    try {
      await build(acct);
      refreshed++;
    } catch (err) {
      console.error(`warning: could not rebuild config for ${acct.slug}: ${err}`);
    }
  }
  if (refreshed !== accounts.length) throw new Error(`Only ${refreshed}/${accounts.length} config dirs refreshed; repair the reported errors and retry cca sync`);
  console.log(`Synced ${accounts.length} launcher(s), refreshed ${refreshed} config dir(s).`);
}
