import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";

// Test the non-Keychain file store directly (works on all platforms).
const DIR = "/tmp/cca-vitest-credstore";

beforeEach(async () => {
  process.env.CLAUDE_ACCOUNTS_DIR = DIR;
  await fs.rm(DIR, { recursive: true, force: true });
});

describe("file credstore (credstore-other)", () => {
  it("round-trips set/get/delete", async () => {
    // Dynamic import after env is set so configRoot() resolves to our temp dir.
    const cs = await import("../src/core/credstore-other.ts");

    expect(await cs.get("svc-a")).toBe("");
    await cs.set("svc-a", "sk-ant-oat-AAA");
    await cs.set("svc-b", "sk-ant-oat-BBB");
    expect(await cs.get("svc-a")).toBe("sk-ant-oat-AAA");
    expect(await cs.get("svc-b")).toBe("sk-ant-oat-BBB");

    await cs.del("svc-a");
    expect(await cs.get("svc-a")).toBe("");
    // svc-b survives deletion of svc-a.
    expect(await cs.get("svc-b")).toBe("sk-ant-oat-BBB");
  });

  it("writes a 0600 file", async () => {
    const cs = await import("../src/core/credstore-other.ts");
    await cs.set("svc", "tok");
    const path = join(DIR, "tokens.json");
    const st = await fs.stat(path);
    // Node doesn't expose sticky bits reliably across platforms; check the low 3 octets.
    const mode = st.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
