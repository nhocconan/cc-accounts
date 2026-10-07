import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as registry from "../src/core/registry.ts";
import * as credentials from "../src/core/credstore-other.ts";
import { build, isolatedName, writeStripped } from "../src/core/isolation.ts";

let root: string;
const account = (slug: string): registry.Account => ({ slug, label: slug, service: `svc-${slug}`, createdAt: "2026-01-01" });
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "cca-storage-"));
  vi.stubEnv("CLAUDE_ACCOUNTS_DIR", root);
  vi.stubEnv("CLAUDE_ACCOUNTS_FILE", join(root, "accounts.json"));
  vi.stubEnv("CLAUDE_ACCOUNTS_CONFIG_DIR", join(root, "configs"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "base"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("registry safety", () => {
  it("rejects non-array registries without overwriting their bytes", async () => {
    const path = join(root, "accounts.json");
    const bytes = '{"futureFormat":true}';
    await fs.writeFile(path, bytes);
    await expect(registry.append(account("work"))).rejects.toThrow("JSON array");
    expect(await fs.readFile(path, "utf8")).toBe(bytes);
  });
  it("preserves unknown fields through another account's mutation and rewrite", async () => {
    await fs.writeFile(join(root, "accounts.json"), JSON.stringify([{ ...account("work"), future: { version: 2 } }]));
    await registry.append(account("home"));
    await registry.rewrite("work", { ...account("work"), label: "Renamed" });
    expect((await registry.find("work"))?.future).toEqual({ version: 2 });
  });
  it("rejects duplicate creation, conflicting rename, and unknown rewrite", async () => {
    await registry.append(account("work"));
    await registry.append(account("home"));
    await expect(registry.append(account("work"))).rejects.toThrow("already exists");
    await expect(registry.rewrite("work", account("home"))).rejects.toThrow("already exists");
    await expect(registry.rewrite("missing", account("other"))).rejects.toThrow("unknown account");
    expect((await registry.load()).map((a) => a.slug)).toEqual(["work", "home"]);
  });
  it("keeps every account during simultaneous mutations", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => registry.append(account(`acct-${i}`))));
    expect(await registry.load()).toHaveLength(12);
  });
});

describe("file credential safety", () => {
  it("round-trips arbitrary service keys without inheriting Object.prototype", async () => {
    expect(await credentials.get("toString")).toBe("");
    await credentials.set("__proto__", "synthetic-token");
    expect(await credentials.get("__proto__")).toBe("synthetic-token");
    await credentials.del("__proto__");
    expect(await credentials.get("__proto__")).toBe("");
  });
  it.each(["[]", "null", '{"service":23}'])("rejects malformed token maps %s without replacing them", async (bytes) => {
    await fs.writeFile(join(root, "tokens.json"), bytes);
    await expect(credentials.set("work", "synthetic-token")).rejects.toThrow("JSON object");
    expect(await fs.readFile(join(root, "tokens.json"), "utf8")).toBe(bytes);
  });
  it("keeps every token during simultaneous writes", async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => credentials.set(`svc-${i}`, `synthetic-${i}`)));
    for (let i = 0; i < 12; i++) expect(await credentials.get(`svc-${i}`)).toBe(`synthetic-${i}`);
  });
});

describe("account identity isolation", () => {
  it("clears persisted overrides and regenerates base settings", async () => {
    const acct = { ...account("work"), overrides: { settings: { model: "override" } } };
    await fs.mkdir(join(root, "base"), { recursive: true });
    await fs.writeFile(join(root, "base", "settings.json"), '{"model":"base"}');
    await registry.append(acct);
    const dir = await build(acct);
    await registry.rewrite("work", account("work"));
    const cleared = (await registry.find("work"))!;
    expect(cleared.overrides).toBeUndefined();
    await build(cleared);
    expect(JSON.parse(await fs.readFile(join(dir, "settings.json"), "utf8"))).toEqual({ model: "base" });
  });
  it("allows simultaneous builds without temporary-file collisions", async () => {
    await fs.mkdir(join(root, "base"), { recursive: true });
    await fs.writeFile(join(root, "base", ".claude.json"), '{"oauthAccount":{"org":"synthetic"},"keep":true}');
    const dirs = await Promise.all(Array.from({ length: 8 }, () => build(account("work"))));
    expect(new Set(dirs).size).toBe(1);
    expect(JSON.parse(await fs.readFile(join(dirs[0]!, ".claude.json"), "utf8"))).toEqual({ keep: true });
    expect((await fs.readdir(dirs[0]!)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects an account directory resolving to the base home before changing identity", async () => {
    const base = join(root, "configs", "work");
    vi.stubEnv("CLAUDE_CONFIG_DIR", base);
    await fs.mkdir(base, { recursive: true });
    const identity = '{"oauthAccount":{"org":"synthetic-base"}}';
    await fs.writeFile(join(base, ".claude.json"), identity);
    await expect(build(account("work"))).rejects.toThrow("must differ");
    expect(await fs.readFile(join(base, ".claude.json"), "utf8")).toBe(identity);
  });

  it.each([".credentials.json", ".credentials.json.backup", ".claude.json.bak", ".claude.json.tmp", "tmp", ".tmp"])("never shares %s", (name) => {
    expect(isolatedName(name)).toBe(true);
  });
  it("does not link base credentials and preserves local account credentials", async () => {
    const base = join(root, "base");
    const destination = join(root, "configs", "work");
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(join(base, ".credentials.json"), "base-synthetic-token");
    await build(account("work"));
    await expect(fs.readFile(join(destination, ".credentials.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await fs.writeFile(join(destination, ".credentials.json"), "account-synthetic-token");
    await build(account("work"));
    expect(await fs.readFile(join(destination, ".credentials.json"), "utf8")).toBe("account-synthetic-token");
    expect(await fs.readFile(join(base, ".credentials.json"), "utf8")).toBe("base-synthetic-token");
  });
  it("prunes legacy credential links even when the base directory is absent", async ({ skip }) => {
    const destination = join(root, "configs", "work");
    await fs.mkdir(destination, { recursive: true });
    const link = join(destination, ".credentials.json");
    try { await fs.symlink(join(root, "base", ".credentials.json"), link); }
    catch (error) {
      if (process.platform === "win32" && ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) { skip(); return; }
      throw error;
    }
    await build(account("work"));
    await expect(fs.lstat(link)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("reports unreadable base directories", async () => {
    vi.spyOn(fs, "readdir").mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EACCES" }));
    await expect(build(account("work"))).rejects.toThrow("denied");
  });
  it.each(["[]", "null", "42"])("rejects non-object base identity config %s", async (bytes) => {
    const src = join(root, "source.json");
    const dst = join(root, "destination.json");
    await fs.writeFile(src, bytes);
    await fs.writeFile(dst, '{"keep":true}');
    await expect(writeStripped(src, dst)).rejects.toThrow("JSON object");
    expect(await fs.readFile(dst, "utf8")).toBe('{"keep":true}');
  });
});


describe("cross-process storage mutations", () => {
  it("keeps independent child-process registry and token writes", async () => {
    const registryUrl = pathToFileURL(join(process.cwd(), "src", "core", "registry.ts")).href;
    const credentialsUrl = pathToFileURL(join(process.cwd(), "src", "core", "credstore-other.ts")).href;
    const run = promisify(execFile);
    await Promise.all(Array.from({ length: 4 }, (_, i) => {
      const script = `import * as registry from ${JSON.stringify(registryUrl)};
import * as credentials from ${JSON.stringify(credentialsUrl)};
await registry.append(${JSON.stringify(account(`child-${i}`))});
await credentials.set("child-${i}", "synthetic-child-${i}");`;
      return run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { env: { ...process.env } });
    }));
    expect(await registry.load()).toHaveLength(4);
    for (let i = 0; i < 4; i++) expect(await credentials.get(`child-${i}`)).toBe(`synthetic-child-${i}`);
  });
});
