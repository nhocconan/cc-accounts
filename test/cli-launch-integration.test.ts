import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

describe("CLI launch actual subprocess", () => {
  it("forwards exact args, isolates auth, propagates exit status", async ({ skip }) => {
    // This fixture executes a POSIX shebang. Windows shim behavior has separate tests.
    if (process.platform === "win32") skip();
    const root = await fs.mkdtemp(join(tmpdir(), "cca-cli-"));
    try {
      const bin = join(root, "bin"); const base = join(root, "base"); const output = join(root, "observed.json");
      await fs.mkdir(bin); await fs.mkdir(base);
      const token = "sk-ant-oat01-" + "x".repeat(40);
      const service = "Claude Accounts: claude-work";
      await fs.writeFile(join(root, "accounts.json"), JSON.stringify([{ slug: "work", label: "Work", service, createdAt: "2026-01-01" }]));
      await fs.writeFile(join(root, "tokens.json"), JSON.stringify({ [service]: token }));
      await fs.writeFile(join(base, ".claude.json"), JSON.stringify({ oauthAccount: { id: "wrong" }, theme: "dark" }));
      const fakeClaude = join(bin, "claude");
      await fs.writeFile(fakeClaude, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({args:process.argv.slice(2), token:process.env.CLAUDE_CODE_OAUTH_TOKEN, config:process.env.CLAUDE_CONFIG_DIR, api:process.env.ANTHROPIC_API_KEY, path:process.env.PATH, cwd:process.cwd()}));process.exit(7);\n`, { mode: 0o755 });
      // Exercise the file store on macOS without ever querying the real Keychain.
      const preload = join(root, "file-store.mjs");
      await fs.writeFile(preload, 'if(process.platform === "darwin") Object.defineProperty(process,"platform",{value:"linux"});');
      const npmBin = join(root, "missing-parent", "node_modules", ".bin");
      const env = { ...process.env, CLAUDE_ACCOUNTS_DIR: root, CLAUDE_ACCOUNTS_BIN_DIR: bin, CLAUDE_CONFIG_DIR: base, CLAUDE_ACCOUNTS_FILE: join(root, "accounts.json"), CLAUDE_ACCOUNTS_TOKENS_FILE: join(root, "tokens.json"), ANTHROPIC_API_KEY: "wrong", PATH: [npmBin, bin, process.env.PATH].join(delimiter) };
      const args = ["--model", "opus", "-p", "hello world", "--name=custom", "--", "--literal"];
      for (const separator of [[], ["--"]]) {
        const result = spawnSync(process.execPath, ["--import", preload, "--import", "tsx", "src/cli.ts", "launch", "work", ...separator, ...args], { env, encoding: "utf8" });
        expect(result.status, result.stderr).toBe(7);
        const observed = JSON.parse(await fs.readFile(output, "utf8"));
        expect(observed.args.slice(-args.length)).toEqual(args);
        expect(observed.token).toBe(token); expect(observed.api).toBeUndefined();
        expect(observed.config).toBe(join(root, "configs", "work"));
        expect(observed.path.split(delimiter)).not.toContain(npmBin);
        expect(observed.path.split(delimiter)).toContain(bin);
        expect(observed.cwd).toBe(process.cwd());
        expect(JSON.parse(await fs.readFile(join(observed.config, ".claude.json"), "utf8"))).toEqual({ theme: "dark" });
      }
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
