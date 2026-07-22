// Interactive `cca` (no args): choose an account, then Launch / Edit / Refresh /
// Remove — or Add a new one. Loops until the user launches a session or cancels.
import { load, command, type Account } from "./core/registry.ts";
import * as credstore from "./core/credstore.ts";
import { sync } from "./core/wrappers.ts";
import { summary } from "./core/usage.ts";
import { launch as doLaunch } from "./core/launcher.ts";
import * as manageAdd from "./commands/add.ts";
import * as manageEdit from "./commands/edit.ts";
import * as manageRefresh from "./commands/refresh.ts";
import * as manageRemove from "./commands/remove.ts";
import { select } from "./ui/select.ts";

function report(err: unknown): void {
  if (err) console.error("error:", err);
}

export async function run(): Promise<number> {
  for (;;) {
    const accounts = await load();
    await sync(accounts);

    const labels: string[] = ["+ Add account"];
    for (const a of accounts) {
      const token = await credstore.get(a.service);
      const state = token ? "configured" : "token missing";
      const usage = await summary(a.slug);
      labels.push(`${a.label}  [${command(a)}]  (${state}; ${usage})`);
    }

    const pick = await select(labels, {
      prompt: "cca > ",
      header: "Select an account to manage or launch",
    });
    if (!pick.ok) return 0;
    if (pick.index === 0) {
      try {
        await manageAdd.add();
      } catch (err) {
        report(err);
      }
      continue;
    }

    const acct = accounts[pick.index - 1];
    if (!acct) continue;

    const actions = [
      ["Launch", "Start Claude with this account"],
      ["Edit", "Change name, slug, or settings overrides"],
      ["Refresh token", "Generate and store a replacement token"],
      ["Remove", "Delete this account and its token"],
      ["Back", "Return to the account list"],
    ] as const;
    const actionLabels = actions.map(([k, v]) => `${k.padEnd(16)} ${v}`);
    const apick = await select(actionLabels, {
      prompt: `${acct.label} > `,
      header: "Choose an action",
    });
    if (!apick.ok) continue;

    switch (apick.index) {
      case 0: {
        // Launch replaces the process effectively; return its exit code.
        const { code } = await doLaunch(acct, []);
        return code;
      }
      case 1:
        try {
          await manageEdit.edit(acct.slug);
        } catch (err) {
          report(err);
        }
        break;
      case 2:
        try {
          await manageRefresh.refresh(acct.slug);
        } catch (err) {
          report(err);
        }
        break;
      case 3:
        try {
          await manageRemove.remove(acct.slug);
        } catch (err) {
          report(err);
        }
        break;
      case 4:
        continue;
    }
  }
}
