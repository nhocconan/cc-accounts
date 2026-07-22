// `cca doctor` — audit configured accounts: token presence/prefix, and whether
// any two accounts resolve to the same subscription (identical token OR identical
// usage fingerprint — the symptom of a token generated under the wrong account).
// Reads only local data; never contacts Anthropic.
import { createHash } from "node:crypto";
import { load, command } from "../core/registry.ts";
import * as credstore from "../core/credstore.ts";
import { summary, fingerprint } from "../core/usage.ts";

export async function doctor(): Promise<void> {
  const accounts = await load();
  if (accounts.length === 0) {
    console.log("No Claude accounts configured. Run: cca add");
    return;
  }

  console.log("Claude accounts doctor\n");
  console.log("  config isolation: per-account CLAUDE_CONFIG_DIR (.claude.json oauthAccount stripped)\n");

  const tokenOwner = new Map<string, string>();
  const usageOwner = new Map<string, string>();
  const warnings: string[] = [];

  for (const acct of accounts) {
    console.log(`● ${acct.label}  (${command(acct)})`);

    const token = await credstore.get(acct.service);
    if (!token) {
      console.log("    token : MISSING — refresh it via: cca refresh " + acct.slug);
      warnings.push(`${acct.label}: no token`);
      console.log();
      continue;
    }
    if (token.startsWith("sk-ant-oat")) {
      console.log("    token : present (OAuth setup-token)");
    } else {
      console.log("    token : present, but unexpected prefix");
      warnings.push(`${acct.label}: token does not look like a setup-token`);
    }

    const h = createHash("sha256").update(token).digest("hex");
    if (tokenOwner.has(h)) {
      const owner = tokenOwner.get(h)!;
      console.log(`    ⚠ identical token to "${owner}" (same account billed for both)`);
      warnings.push(`${acct.label} and ${owner} share one token`);
    } else {
      tokenOwner.set(h, acct.label);
    }

    console.log(`    usage : ${await summary(acct.slug)}`);
    const fp = await fingerprint(acct.slug);
    if (fp) {
      if (usageOwner.has(fp)) {
        const owner = usageOwner.get(fp)!;
        console.log(`    ⚠ identical usage to "${owner}" — likely the SAME subscription`);
        warnings.push(
          `${acct.label} and ${owner} report identical usage; one token was probably generated under the wrong account`,
        );
      } else {
        usageOwner.set(fp, acct.label);
      }
    }
    console.log();
  }

  if (warnings.length > 0) {
    console.log("Findings:");
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  } else {
    console.log("✓ No problems detected.");
  }
  console.log();
  console.log("Usage reflects each account's last launch — launch one, then re-run");
  console.log("'cca doctor'. Two accounts with identical usage are billing");
  console.log("the same subscription.");
}
