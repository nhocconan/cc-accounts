// `cca list` — print configured accounts with their command + usage meter.
import { load, command } from "../core/registry.ts";
import { summary } from "../core/usage.ts";

export async function list(): Promise<void> {
  const accounts = await load();
  if (accounts.length === 0) {
    console.log("No Claude accounts configured. Run: cca add");
    return;
  }
  for (const acct of accounts) {
    const usage = await summary(acct.slug);
    console.log(`${command(acct).padEnd(22)}  ${acct.label.padEnd(30)}  ${usage}`);
  }
}
