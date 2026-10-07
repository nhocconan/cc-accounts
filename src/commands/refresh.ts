// `cca refresh <slug>` — replace an account's token. Runs claude setup-token
// (unless --token is given) and updates the credential store.
import { find } from "../core/registry.ts";
import * as credstore from "../core/credstore.ts";
import { clearUsage } from "./util.ts";
import { withMutationLock } from "../core/lock.ts";
import { validateToken, runSetupToken } from "./add.ts";

export interface RefreshOptions {
  token?: string;
}

export async function refresh(slug: string, opts: RefreshOptions = {}): Promise<void> {
  const acct = await find(slug);
  if (!acct) throw new Error(`unknown account: ${slug}`);

  let token = opts.token;
  if (!token) token = process.env.CLAUDE_CODE_OAUTH_TOKEN || (await runSetupToken(acct.label));
  validateToken(token);

  await withMutationLock(slug, async () => {
    const current = await find(slug);
    if (!current) throw new Error(`unknown account: ${slug}`);
    await credstore.set(current.service, token);
    await clearUsage(slug);
  });
  console.log(`Refreshed token for ${acct.label}.`);
}
