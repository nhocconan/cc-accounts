import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
import * as credentials from "../src/core/credstore-darwin.ts";
beforeEach(() => { mocks.execFile.mockReset(); });
it("never exposes command arguments or partial output on Keychain failures", async () => {
  const sensitive = "synthetic-secret-token";
  mocks.execFile.mockImplementation((_file, _args, callback) => {
    callback(Object.assign(new Error(`command failed: security -w ${sensitive}`), {
      code: 1, stdout: sensitive, stderr: sensitive, cmd: `security -w ${sensitive}`,
    }));
  });
  for (const operation of [() => credentials.set("synthetic-service", sensitive), () => credentials.get("synthetic-service"), () => credentials.del("synthetic-service")]) {
    let caught: unknown;
    try { await operation(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain("macOS Keychain");
    expect(String(caught)).not.toContain(sensitive);
    expect(JSON.stringify(caught)).not.toContain(sensitive);
    expect((caught as Error).cause).toBeUndefined();
  }
});
it("keeps missing-item reads and deletes successful", async () => {
  mocks.execFile.mockImplementation((_file, _args, callback) => callback(Object.assign(new Error("missing"), { code: 44 })));
  expect(await credentials.get("synthetic-service")).toBe("");
  await expect(credentials.del("synthetic-service")).resolves.toBeUndefined();
});
