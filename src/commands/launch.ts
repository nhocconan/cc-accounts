// `cca launch <slug> [claude args...]` — launch Claude as the given account.
import { find } from "../core/registry.ts";
import { launch as doLaunch } from "../core/launcher.ts";

export async function launch(slug: string, args: string[]): Promise<number> {
  const acct = await find(slug);
  if (!acct) {
    throw new Error(`unknown account: ${slug}\nRun: cca   (then choose Add)`);
  }
  const { code } = await doLaunch(acct, args);
  return code;
}
