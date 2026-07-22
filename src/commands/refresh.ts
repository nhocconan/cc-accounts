// `cca refresh <slug>` — replace an account's token. Runs claude setup-token
// (unless --token is given) and updates the credential store.
import { spawn } from "node:child_process";
import { find } from "../core/registry.ts";
import * as credstore from "../core/credstore.ts";
import { clearUsage } from "./util.ts";
import { resolveClaudeBin } from "../core/paths.ts";
import { promptLine } from "../ui/select.ts";
import { validateToken, scrubbedEnv } from "./add.ts";

export interface RefreshOptions {
  token?: string;
}

export async function refresh(slug: string, opts: RefreshOptions = {}): Promise<void> {
  const acct = await find(slug);
  if (!acct) throw new Error(`unknown account: ${slug}`);

  let token = opts.token;
  if (!token) token = process.env.CLAUDE_CODE_OAUTH_TOKEN || (await runSetupToken(acct.label));
  validateToken(token);

  await credstore.set(acct.service, token);
  await clearUsage(slug);
  console.log(`Refreshed token for ${acct.label}.`);
}

async function runSetupToken(label: string): Promise<string> {
  process.stderr.write(`Generating a new one-year OAuth token for ${label}.\n\n`);
  const bin = resolveClaudeBin();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ["setup-token"], { stdio: "inherit", env: scrubbedEnv() });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`setup-token exited ${code}`))));
    child.on("error", reject);
  });
  const token = await promptLine("Paste the generated token");
  if (!token) throw new Error("no token supplied; nothing was stored");
  return token;
}
