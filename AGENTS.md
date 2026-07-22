# Agent guidelines — cc-accounts

Rules for any AI agent (or human) working in this repo. Read before editing.

## Cross-platform: never assert Unix-specific behavior in tests

This project runs CI on **ubuntu, macOS, and Windows** (see `.github/workflows/ci.yml`).
Windows' filesystem (NTFS) silently ignores Unix permission bits:

- `fs.writeFile(path, data, { mode: 0o600 })` is a **no-op** on Windows.
- `fs.stat(path).mode` always reads **0o666** on Windows, regardless of the mode
  passed to `writeFile`/`mkdir`/`symlink`.

**Rule:** Do NOT write test assertions that check file/directory mode bits
(`st.mode & 0o777 === 0o600`) without guarding them for the platform. Either:

```ts
// Option A — skip on Windows
it("writes a 0600 file", async ({ skip }) => {
  if (process.platform === "win32") skip();
  // ... assert mode === 0o600
});

// Option B — assert the cross-platform-relevant property instead
// (e.g. file exists, contents are correct, not the permission bits)
```

**Why this rule exists:** A hard-coded `expect(mode).toBe(0o600)` broke CI on
`windows-latest` (got 0o666) even though the underlying `credstore` write is
correct — the OS just won't honor the bits. See commit history for the fix.

### Other Windows gotchas to keep in mind

- **Symlinks:** require either Developer Mode or admin privileges on Windows.
  The isolation layer links `~/.claude/*` into each account's config dir; if a
  test creates symlinks, it must tolerate the absence of Developer Mode (CI
  runners do have it, but be defensive in assertions).
- **Path separators:** use `node:path` (`join`, `sep`) — never hard-code `/` or
  `\` in string paths.
- **Line endings:** keep `.gitignore` / configs LF. The repo has no
  `.gitattributes`; if binary/line-ending issues appear, add one.

## Testing principles

- Prefer **behavior assertions** (round-trip read/write, content equality) over
  **platform-mechanic assertions** (permission bits, inode types) unless the
  mechanic is the thing under test *and* is cross-platform.
- Run `npm test` locally before committing. CI matrix is ubuntu + macOS +
  Windows — a green local run on one OS does NOT guarantee green CI.

## Build & verification

Before pushing or opening a PR:

```bash
npm run typecheck   # tsc --noEmit — must be clean
npm test            # vitest run — all tests pass
npm run build       # tsup — produces dist/cli.js (the published bin)
node dist/cli.js --version   # smoke: the bundle runs
```

If any step fails, fix it before pushing. Do not push known-broken code.
