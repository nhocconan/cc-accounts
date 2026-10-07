// `cca doctor` — audit configured accounts: token presence/prefix, and whether
// any two accounts resolve to the same subscription (identical token OR identical
// usage fingerprint — the symptom of a token generated under the wrong account).
// Reads only local data; never contacts Anthropic.
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { load, command } from "../core/registry.ts";
import * as credstore from "../core/credstore.ts";
import { summary, fingerprint } from "../core/usage.ts";
import { configDirFor, defaultBinDir, resolveClaudeBin, resolveSelfBinary } from "../core/paths.ts";

export async function doctor(): Promise<number> {
  const accounts = await load();
  if (accounts.length === 0) {
    console.log("No Claude accounts configured. Run: cca add");
    return 0;
  }

  console.log("Claude accounts doctor\n");
  console.log("  config isolation: per-account CLAUDE_CONFIG_DIR (.claude.json oauthAccount stripped)");
  // Resolved fresh on every launch — never pinned. Worth showing, because with
  // several claude installs on PATH it answers "which one do my accounts run?".
  let claudeBin = "unavailable";
  try { claudeBin = resolveClaudeBin(); } catch { /* reported below */ }
  const known = existsSync(claudeBin);
  console.log(`  claude binary   : ${claudeBin}${known ? "" : "  (not found on PATH!)"}`);
  console.log("  cca binary      : " + resolveSelfBinary() + "\n");

  const tokenOwner = new Map<string, string>();
  const usageOwner = new Map<string, string>();
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!known) errors.push("Claude executable is missing; install Claude or correct PATH");

  for (const acct of accounts) {
    console.log(`● ${acct.label}  (${command(acct)})`);
    await inspectIntegrity(acct.slug, acct.label, errors);

    let token = "";
    try { token = await credstore.get(acct.service); }
    catch {
      errors.push(`${acct.label}: credential store could not be read`);
      console.log("    token : credential store unavailable\n");
      continue;
    }
    if (!token) {
      console.log("    token : MISSING — refresh it via: cca refresh " + acct.slug);
      errors.push(`${acct.label}: no token`);
      console.log();
      continue;
    }
    if (/^sk-ant-oat[A-Za-z0-9_-]{20,}$/.test(token)) {
      console.log("    token : present (OAuth setup-token)");
    } else {
      console.log("    token : present, but unexpected prefix");
      errors.push(`${acct.label}: token does not look like a setup-token`);
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
        console.log(`    ⚠ identical usage to "${owner}" — matching cached usage; check account identity`);
        warnings.push(
          `${acct.label} and ${owner} report identical usage; matching usage is a heuristic, not proof of shared billing`,
        );
      } else {
        usageOwner.set(fp, acct.label);
      }
    }
    console.log();
  }

  if (errors.length > 0) {
    console.log("Errors:");
    for (const error of errors) console.log(`  ✖ ${error}`);
  }
  if (warnings.length > 0) {
    console.log("Findings:");
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  } else if (errors.length === 0) {
    console.log("✓ No problems detected.");
  }
  console.log();
  console.log("Usage reflects each account's last launch — launch one, then re-run");
  console.log("'cca doctor'. Matching usage is advisory; verify the browser account");
  console.log("used to generate each token.");
  return errors.length > 0 ? 1 : 0;
}

async function inspectIntegrity(slug: string, label: string, errors: string[]): Promise<void> {
  const home = configDirFor(slug);
  const identity = join(home, ".claude.json");
  try {
    if ((await fs.lstat(home)).isSymbolicLink()) {
      throw new Error("account config directory is a symlink");
    }
    const stat = await fs.lstat(identity);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      errors.push(`${label}: isolated .claude.json must be a real file; run cca sync`);
    } else {
      const parsed: unknown = JSON.parse(await fs.readFile(identity, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push(`${label}: isolated .claude.json is invalid; run cca sync`);
      } else if (Object.hasOwn(parsed, "oauthAccount")) {
        errors.push(`${label}: isolated .claude.json contains cached account identity; run cca sync`);
      }
    }
  } catch {
    errors.push(`${label}: isolated .claude.json is missing or unreadable; run cca sync`);
  }
  try {
    if ((await fs.lstat(join(home, ".credentials.json"))).isSymbolicLink()) {
      errors.push(`${label}: private .credentials.json is a symlink; run cca sync`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      errors.push(`${label}: private credential path could not be inspected`);
    }
  }
  const launcher = join(defaultBinDir(), `claude-${slug}${process.platform === "win32" ? ".cmd" : ""}`);
  try {
    const stat = await fs.lstat(launcher);
    let owned = false;
    if (stat.isSymbolicLink()) {
      const target = resolve(dirname(launcher), await fs.readlink(launcher));
      owned = await fs.realpath(target) === await fs.realpath(resolveSelfBinary());
    } else if (stat.isFile()) {
      const source = await fs.readFile(launcher, "utf8");
      owned = source.includes("// cc-accounts launcher") || source.includes("rem cc-accounts launcher");
    }
    if (!owned) errors.push(`${label}: launcher is owned by another file; choose another launcher directory`);
  } catch {
    errors.push(`${label}: launcher is missing or unreadable; run cca sync`);
  }
}
