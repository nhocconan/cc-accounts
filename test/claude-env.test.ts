import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sanitizeClaudePath } from "../src/core/claude-env.ts";
import { buildEnv } from "../src/core/launcher.ts";
import { scrubbedEnv } from "../src/commands/add.ts";
import type { Account } from "../src/core/registry.ts";

let root = "";
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

it("both Claude launch paths remove nonexistent npm bins and preserve usable tools", async () => {
  root = await fs.mkdtemp(join(tmpdir(), "cca-path-"));
  const existing = join(root, "project", "node_modules", ".bin");
  await fs.mkdir(existing, { recursive: true });
  const missing = join(root, "parent", "node_modules", ".bin");
  const notDirectory = join(root, "file", "node_modules", ".bin");
  await fs.writeFile(join(root, "file"), "fixture");
  const unrelated = join(root, "other-missing-bin");
  const input = [missing, existing, notDirectory, unrelated, ""].join(delimiter);
  vi.stubEnv("PATH", input);
  const expected = [existing, unrelated, ""].join(delimiter);
  expect(buildEnv("fixture", { slug: "work", label: "Work" } as Account, "fixture-home").PATH).toBe(expected);
  expect(scrubbedEnv().PATH).toBe(expected);
  expect(process.env.PATH).toBe(input);
});

it("handles Windows Path casing, quoted paths, separators and npm directory casing", async () => {
  root = await fs.mkdtemp(join(tmpdir(), "cca-win-path-"));
  const existing = join(root, "Node_Modules", ".bin");
  await fs.mkdir(existing, { recursive: true });
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  // Use the host delimiter so filesystem checks still exercise actual paths.
  const env = { Path: [String.fromCharCode(34) + existing + '"', join(root, "missing", "Node_Modules", ".bin")].join(delimiter) };
  sanitizeClaudePath(env);
  expect(env.Path).toBe('"' + existing + '"');
});

it("leaves an absent PATH absent", () => {
  const env = {};
  sanitizeClaudePath(env);
  expect(env).toEqual({});
});
