import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { build, writeStripped, isolatedName } from "../src/core/isolation.ts";
import type { Account } from "../src/core/registry.ts";

const DIR = "/tmp/cca-vitest-isolation";

beforeEach(async () => {
  process.env.CLAUDE_ACCOUNTS_DIR = DIR;
  process.env.CLAUDE_ACCOUNTS_CONFIG_DIR = join(DIR, "configs");
  await fs.rm(DIR, { recursive: true, force: true });
});

describe("isolatedName", () => {
  it("flags runtime files that must stay per-account", () => {
    expect(isolatedName("settings.json")).toBe(false);
    expect(isolatedName("plugins")).toBe(false);
    expect(isolatedName("daemon")).toBe(true);
    expect(isolatedName("daemon.lock")).toBe(true);
    expect(isolatedName("foo.lock")).toBe(true);
    expect(isolatedName("bridge.sock")).toBe(true);
  });
});

describe("writeStripped", () => {
  it("removes oauthAccount and preserves everything else", async () => {
    const src = join(DIR, "src.json");
    const dst = join(DIR, "dst.json");
    await fs.mkdir(DIR, { recursive: true });
    // Includes a float, a null, and nesting — all must survive untouched.
    const input = {
      oauthAccount: { organizationUuid: "x" },
      numStartups: 7,
      ratio: 0.15,
      nilable: null,
      nested: { a: [1, 2, 3] },
    };
    await fs.writeFile(src, JSON.stringify(input));
    await writeStripped(src, dst);

    const got = JSON.parse(await fs.readFile(dst, "utf8"));
    expect(got.oauthAccount).toBeUndefined();
    expect(got.numStartups).toBe(7);
    expect(got.ratio).toBe(0.15); // exact float preserved
    expect(got.nilable).toBeNull();
    expect(got.nested).toEqual({ a: [1, 2, 3] });
  });

  it("writes {} when source is missing", async () => {
    const dst = join(DIR, "dst.json");
    await fs.mkdir(DIR, { recursive: true });
    await writeStripped(join(DIR, "absent.json"), dst);
    expect((await fs.readFile(dst, "utf8")).trim()).toBe("{}");
  });
});

describe("build", () => {
  it("shares base entries via symlink and strips oauthAccount", async () => {
    // Set up a fake ~/.claude base.
    const base = join(DIR, "claude-home");
    process.env.CLAUDE_CONFIG_DIR = base;
    process.env.CLAUDE_ACCOUNTS_CONFIG_DIR = join(DIR, "configs");

    await fs.mkdir(join(base, "plugins"), { recursive: true });
    await fs.writeFile(join(base, ".claude.json"), JSON.stringify({ oauthAccount: { org: "x" }, keep: 0.15 }));
    await fs.writeFile(join(base, "settings.json"), JSON.stringify({ model: "opus" }));
    await fs.writeFile(join(base, "plugins", "p.txt"), "plugin");
    await fs.writeFile(join(base, "daemon.lock"), "lock");

    const acct: Account = {
      slug: "acct",
      label: "Acct",
      service: "svc",
      createdAt: "2026-01-01",
    };
    const dir = await build(acct);

    // .claude.json is stripped (no oauthAccount, keep preserved).
    const json = JSON.parse(await fs.readFile(join(dir, ".claude.json"), "utf8"));
    expect(json.oauthAccount).toBeUndefined();
    expect(json.keep).toBe(0.15);

    // settings.json and plugins/p.txt are shared via symlink.
    expect(await fs.readFile(join(dir, "settings.json"), "utf8")).toBe(JSON.stringify({ model: "opus" }));
    expect(await fs.readFile(join(dir, "plugins", "p.txt"), "utf8")).toBe("plugin");

    // daemon.lock is NOT shared.
    await expect(fs.lstat(join(dir, "daemon.lock"))).rejects.toThrow();
  });

  it("writes merged settings when account has overrides", async () => {
    const base = join(DIR, "claude-home2");
    process.env.CLAUDE_CONFIG_DIR = base;
    process.env.CLAUDE_ACCOUNTS_CONFIG_DIR = join(DIR, "configs2");

    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(join(base, "settings.json"), JSON.stringify({ model: "opus", env: { FOO: "1" } }));
    await fs.writeFile(join(base, ".claude.json"), JSON.stringify({ keep: true }));

    const acct: Account = {
      slug: "over",
      label: "Over",
      service: "svc",
      createdAt: "2026-01-01",
      overrides: { settings: { model: "sonnet", env: { BAR: "2" } } },
    };
    const dir = await build(acct);

    // settings.json is a real (merged) file, not a symlink.
    const st = await fs.lstat(join(dir, "settings.json"));
    expect(st.isSymbolicLink()).toBe(false);

    const settings = JSON.parse(await fs.readFile(join(dir, "settings.json"), "utf8"));
    // override wins for model; env is deep-merged.
    expect(settings.model).toBe("sonnet");
    expect(settings.env).toEqual({ FOO: "1", BAR: "2" });
  });
});
