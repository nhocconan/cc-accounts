import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { summary, fingerprint, fiveHourNearLimit } from "../src/core/usage.ts";

const DIR = "/tmp/cca-vitest-usage";

async function writeSnapshot(slug: string, data: unknown): Promise<void> {
  const dir = join(DIR, "usage");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, `${slug}.json`), JSON.stringify(data));
}

beforeEach(async () => {
  process.env.CLAUDE_ACCOUNTS_DIR = DIR;
  process.env.CLAUDE_ACCOUNTS_USAGE_DIR = join(DIR, "usage");
  await fs.rm(DIR, { recursive: true, force: true });
});

describe("usage", () => {
  it("summary returns 'usage pending' with no data", async () => {
    expect(await summary("ghost")).toBe("usage pending");
  });

  it("summary formats 5h/7d percentages", async () => {
    await writeSnapshot("work", {
      captured_at: 1000,
      rate_limits: { five_hour: { used_percentage: 42 }, seven_day: { used_percentage: 17 } },
    });
    expect(await summary("work")).toBe("5h 42% · 7d 17% used");
  });

  it("summary handles only 5h", async () => {
    await writeSnapshot("half", {
      captured_at: 1000,
      rate_limits: { five_hour: { used_percentage: 90 } },
    });
    expect(await summary("half")).toBe("5h 90% used");
  });

  it("fingerprint is stable and distinguishes accounts", async () => {
    await writeSnapshot("a", {
      rate_limits: { five_hour: { used_percentage: 42, resets_at: 100 }, seven_day: { used_percentage: 17 } },
    });
    await writeSnapshot("b", {
      rate_limits: { five_hour: { used_percentage: 42, resets_at: 100 }, seven_day: { used_percentage: 17 } },
    });
    await writeSnapshot("c", {
      rate_limits: { five_hour: { used_percentage: 99, resets_at: 100 }, seven_day: { used_percentage: 17 } },
    });
    const fa = await fingerprint("a");
    const fb = await fingerprint("b");
    const fc = await fingerprint("c");
    expect(fa).toBe(fb); // identical → same fingerprint (doctor would flag this)
    expect(fa).not.toBe(fc); // different
  });

  it("fiveHourNearLimit reports when active and above threshold", async () => {
    const now = 1000;
    await writeSnapshot("hot", {
      rate_limits: { five_hour: { used_percentage: 90, resets_at: now + 1000 } },
    });
    const r = await fiveHourNearLimit("hot", 85, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pct).toBe(90);
  });

  it("fiveHourNearLimit is false when below threshold", async () => {
    const now = 1000;
    await writeSnapshot("cool", {
      rate_limits: { five_hour: { used_percentage: 50, resets_at: now + 1000 } },
    });
    const r = await fiveHourNearLimit("cool", 85, now);
    expect(r.ok).toBe(false);
  });

  it("fiveHourNearLimit is false when window expired", async () => {
    await writeSnapshot("done", {
      rate_limits: { five_hour: { used_percentage: 95, resets_at: 500 } },
    });
    const r = await fiveHourNearLimit("done", 85, 1000);
    expect(r.ok).toBe(false);
  });
});
