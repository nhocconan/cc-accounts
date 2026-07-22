// The claude-<slug> launchers are symlinks to wherever `cca` resolves to at
// the time they are created. Two ways that goes stale later:
//   - run under `npx`, where the binary lives in a cache npm may evict
//   - no global install, where the fallback path may not exist at all
// Either way the launcher breaks long after the command that made it, so sync()
// warns up front. These lock that warning's trigger conditions.
import { afterEach, describe, expect, it, vi } from "vitest";
import { warnIfTargetIsTransient } from "../src/core/wrappers.ts";

function captureStderr(fn: () => void): string {
  let out = "";
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => ((out += String(chunk)), true));
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe("warnIfTargetIsTransient", () => {
  it("stays silent for a real, permanent path", () => {
    // This test file itself is a path that certainly exists and is not a cache.
    expect(captureStderr(() => warnIfTargetIsTransient(__filename))).toBe("");
  });

  it("warns when the target does not exist", () => {
    const out = captureStderr(() => warnIfTargetIsTransient("/nonexistent/bin/cca"));
    expect(out).toContain("does not exist");
    expect(out).toContain("npm install -g cc-accounts");
  });

  it("warns for an npx cache path even though the file is there right now", () => {
    // Uses this very file's contents under a fabricated _npx path: existence is
    // not the point, eviction is.
    const out = captureStderr(() =>
      warnIfTargetIsTransient("/Users/me/.npm/_npx/9f2a/node_modules/.bin/cca"),
    );
    expect(out).toContain("temporary cache");
    expect(out).toContain("npm install -g cc-accounts");
  });

  it("warns for the _cacache path too", () => {
    const out = captureStderr(() => warnIfTargetIsTransient("/Users/me/.npm/_cacache/tmp/cca"));
    expect(out).toMatch(/temporary cache|does not exist/);
  });
});
