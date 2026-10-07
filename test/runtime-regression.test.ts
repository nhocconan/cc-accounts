import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { writeMergedSettings, deepMerge } from "../src/core/settings.ts";
import { serviceFor } from "../src/core/registry.ts";

let root: string;
const original = { ...process.env };
beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), "cca-runtime-")); process.env.CLAUDE_ACCOUNTS_DIR = root; process.env.CLAUDE_CONFIG_DIR = join(root, "base"); });
afterEach(async () => { process.env = { ...original }; await fs.rm(root, { recursive: true, force: true }); });
const acct = { slug: "work", label: "Work", service: serviceFor("work"), createdAt: "2026-01-01" };
describe("settings boundaries", () => {
  it("removes provider/auth overrides without modifying the base", async () => {
    const base = process.env.CLAUDE_CONFIG_DIR!;
    await fs.mkdir(base, { recursive: true });
    const settings = { env: { ANTHROPIC_API_KEY: "base-secret", SAFE: "yes" }, model: "base" };
    await fs.writeFile(join(base, "settings.json"), JSON.stringify(settings));
    await writeMergedSettings({ ...acct, overrides: { settings: { env: { CLAUDE_CODE_OAUTH_TOKEN: "wrong-token", claude_config_dir: "wrong-dir" } } } }, join(root, "account"));
    const result = JSON.parse(await fs.readFile(join(root, "account", "settings.json"), "utf8"));
    expect(result.env).toEqual({ SAFE: "yes" });
    expect(JSON.parse(await fs.readFile(join(base, "settings.json"), "utf8"))).toEqual(settings);
  });
  it("keeps prototype keys as inert own JSON properties", () => {
    const merged = deepMerge({}, JSON.parse('{"__proto__":{"injected":true}}'));
    expect(({} as Record<string, unknown>).injected).toBeUndefined();
    expect(Object.hasOwn(merged as object, "__proto__")).toBe(true);
  });
});
describe("statusline actual process", () => {
  it.each(["null", "[]", "false", "{", '{"rate_limits":{"five_hour":{"used_percentage":"oops"}}}'])("renders label safely for %s", input => {
    const child = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "statusline"], { input, encoding: "utf8", env: { ...process.env, CLAUDE_ACCOUNTS_LABEL: "Work", CLAUDE_ACCOUNTS_SLUG: "work" } });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe("Work");
  });
});
