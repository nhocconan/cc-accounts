import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import * as registry from "../src/core/registry.ts";

const DIR = "/tmp/cca-vitest-registry";

beforeEach(async () => {
  process.env.CLAUDE_ACCOUNTS_DIR = DIR;
  process.env.CLAUDE_ACCOUNTS_FILE = join(DIR, "accounts.json");
  await fs.rm(DIR, { recursive: true, force: true });
});

describe("slugify", () => {
  it("derives slugs from display names", () => {
    expect(registry.slugify("Gmail Work")).toBe("gmail-work");
    expect(registry.slugify("claude-naver")).toBe("naver");
    expect(registry.slugify("  Spaces  ")).toBe("spaces");
    expect(registry.slugify("A--B")).toBe("a-b");
    expect(registry.slugify("Work_2!")).toBe("work-2");
    expect(registry.slugify("Personal")).toBe("personal");
  });
});

describe("validSlug", () => {
  it("accepts good slugs", () => {
    expect(registry.validSlug("gmail")).toBe(true);
    expect(registry.validSlug("work-2")).toBe(true);
    expect(registry.validSlug("claude-team")).toBe(true);
  });
  it("rejects bad slugs", () => {
    expect(registry.validSlug("")).toBe(false);
    expect(registry.validSlug("-x")).toBe(false);
    expect(registry.validSlug("x-")).toBe(false);
    expect(registry.validSlug("Up")).toBe(false);
    expect(registry.validSlug("a_b")).toBe(false);
    expect(registry.validSlug("a b")).toBe(false);
  });
});

describe("registry load/append/remove", () => {
  it("returns empty list when no file", async () => {
    expect(await registry.load()).toEqual([]);
  });

  it("appends and loads accounts", async () => {
    await registry.append({
      slug: "work",
      label: "Work",
      service: registry.serviceFor("work"),
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await registry.append({
      slug: "home",
      label: "Home",
      service: registry.serviceFor("home"),
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const accounts = await registry.load();
    expect(accounts).toHaveLength(2);
    expect(accounts[0]?.slug).toBe("work");
    expect(accounts[1]?.slug).toBe("home");
  });

  it("removes accounts", async () => {
    await registry.append({
      slug: "work",
      label: "Work",
      service: "svc",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await registry.append({
      slug: "home",
      label: "Home",
      service: "svc",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await registry.remove("work");
    const accounts = await registry.load();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.slug).toBe("home");
  });

  it("finds a specific account", async () => {
    await registry.append({
      slug: "team",
      label: "Team",
      service: "svc",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const found = await registry.find("team");
    expect(found?.label).toBe("Team");
    expect(await registry.find("nope")).toBeUndefined();
  });

  it("skips malformed entries on load", async () => {
    await fs.mkdir(DIR, { recursive: true });
    // Mix of valid + invalid rows (invalid slug, duplicate slug).
    await fs.writeFile(
      join(DIR, "accounts.json"),
      JSON.stringify([
        { slug: "gmail", label: "Gmail", service: "svc", createdAt: "x" },
        { slug: "gmail", label: "Dup", service: "svc", createdAt: "x" }, // duplicate → skipped
        { slug: "Bad_Slug", label: "x", service: "svc", createdAt: "x" }, // invalid → skipped
        { slug: "", label: "empty", service: "svc", createdAt: "x" }, // empty → skipped
      ]),
    );
    const accounts = await registry.load();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.slug).toBe("gmail");
  });

  it("command() and serviceFor()", () => {
    expect(registry.command({ slug: "work", label: "x", service: "s", createdAt: "x" })).toBe(
      "claude-work",
    );
    expect(registry.serviceFor("work")).toBe("Claude Accounts: claude-work");
  });
});
