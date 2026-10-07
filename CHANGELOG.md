# Changelog

## Unreleased

- Stop forcing `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, which enables additional
  Linux isolation even with sandbox settings disabled, blocks lockfile/worktree
  writes and Docker access, and overrides permission modes. Preserve explicit
  user choices in the environment and settings.
- Filter nonexistent npm `node_modules/.bin` paths from session and setup-token
  environments so npx launchers do not break Claude's Bash sandbox under
  unwritable ancestor directories. Preserve existing tools and sandbox settings.
- Add subprocess regression coverage and a Claude environment audit to CI and
  release verification.

## [0.1.5] - 2026-10-07

- Port applicable reliability fixes from codex-multi: durable launcher recovery,
  explicit npx binary selection, Windows shims and quoting, serialized storage
  and launcher writes, and diagnostic error exit codes.
- Keep base credentials and identity backups out of account mirrors; regenerate
  settings and scrub competing provider/authentication overrides.
- Preserve exact launch arguments, current account metadata, child signals and
  exit codes; stop launch when isolation cannot be built.
- Validate account settings and labels before storing tokens; roll back ordinary
  failed mutations and preserve private config data when renaming.
- Refuse duplicate account writes and orphan rename destinations; sanitize
  credential-store error messages.
- Share captured setup-token flow between add and refresh; remove capture files
  and stop on subprocess failure or closed input.
- Handle malformed statusline JSON, concurrent cache writes, menu repaint and EOF.
- Match CLI version to package metadata, verify version/publish artifacts, and
  retain release commits for inspection after publish failures.
- Update test tooling and transitive dependencies to clear the dependency audit.
