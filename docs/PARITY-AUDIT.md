# Codex reliability applicability audit

Comparison baseline: `codex-cli-switch` commit `020f0da` (package 0.2.3), inspected source, tests, CHANGELOG and history. Claude baseline was package 0.1.4. This matrix records baseline gaps and their verification requirements. Applicable launcher, storage, command, UI, and release safeguards have been implemented; final verification is recorded below. No real credentials were inspected.

| Priority | Codex mechanism and evidence | Claude applicability / baseline finding | Required behavior verification |
| --- | --- | --- | --- |
| P0 | Serialized registry writes, two-tier mutex, stale lock recovery; `core/lock.ts`, `test/lock.test.ts`, commits `8864257`, `8cf91e6` | Applicable: no baseline locking; fixed `.tmp` writes collide | Concurrent updates preserve all entries; dead owner reclaimed once; double release harmless |
| P0 | Transactional add/edit/remove; `commands/*`, `test/integration.test.ts` | Applicable: add stores token before settings validation; rename deletes old credential before registry commit; removal suppresses deletion failures | Inject failures at each boundary; preserve old usable account or explicit recoverable cleanup state; concurrent same-slug add has one winner |
| P0 | Launch dispatch before flag parsing; `cli.ts` | Applicable: Claude drops long flags and reorders short flags unless after `--` | Exact ordered argv round trip, with and without separator |
| P1 | Fail-closed registry shape, preserve unknown fields; `core/registry.ts`, `test/registry.test.ts` | Applicable: wrong root silently becomes empty; mutations discard evolving metadata | Unsupported root leaves original unchanged; unknown fields on valid rows survive unrelated writes (malformed rows retain baseline skip behavior) |
| P1 | Orphan directory protection, lifecycle locks, interrupted-removal recovery; `test/integration.test.ts` | Applicable with adaptation to Keychain/file token stores; baseline rename/remove lacks rollback and config cleanup | Destination orphan untouched; active session config safe; retry cleanup after interruption |
| P1 | Strict label validation; `registry.validLabel` | Applicable: baseline rejects tabs/newlines only; edit accepts empty label | Reject empty, C0 and DEL in add/edit/read; never render injected escapes |
| P1 | Login rollback, common login implementation; `core/login.ts`, `test/login.test.ts` | Applicable principle: refresh baseline still manual-paste despite add's captured setup-token fix | Shared captured login flow; failed login leaves previous token usable; capture removed on failure |
| P1 | Current managed configuration regeneration; `core/profile-home.ts` | Applicable: clearing Claude settings overrides preserves old real settings file | Set override, clear, rebuild: inherited settings restored; base never mutated |
| P1 | Doctor fatal/advisory split; `commands/doctor.ts`, `test/doctor.test.ts`, 0.2.2 changelog | Applicable: baseline Claude always exits 0 and does not audit launcher/config integrity | Invalid/missing token/config/launcher gives 1; duplicate warning gives 0 |
| P1 | Generated package version and verified release hooks; `version.ts`, `package.json` | Applicable: baseline CLI hardcodes 0.1.0 vs package 0.1.4 | Bundle version equals package; version/publish runs typecheck, tests, build, smoke, pack |
| P1 | Tiered durable manager resolution, explicit npx bin, isolated prefix; `core/wrappers.ts`, 0.2.1/0.2.2 changelog | Applicable: baseline symlink points at transient npx install | Recorded path absent → PATH manager → explicit npx fallback; local package collision and offline PATH cases |
| P1 | Writable persistent PATH destination, cross-platform quoting; `core/paths.ts`, wrappers tests | Applicable: baseline uses colon splitting, transient PATH entries and Unix symlinks | Windows delimiter/PATHEXT/shims; spaces and quotes; foreign launcher preserved; transient npm bin skipped |
| P1 | Runtime-private data, legacy link repair; `core/profile-home.ts`, 0.2.3 changelog | Principle applicable; Claude already excludes daemon, daemon.*, lock and socket names | Private runtime never linked; legacy links removed; real private state retained; unsafe credential names excluded |
| P2 | Interactive menu repaint and routing; `ui.ts`, `test/tui.test.ts` | Claude has richer per-account loop already; baseline arrow repaint appends menus, non-TTY EOF hangs | Repaint in place, restore raw mode and listeners on cancel/end; numbered EOF cancels; closed prompts reject |
| P2 | Stable identity duplicate diagnostics; `core/auth.ts`, `test/auth.test.ts` | Exact token hash already present. Equal cached Claude usage is only a heuristic, not proof of same subscription | Warnings distinguish exact token equality from possible usage coincidence |
| P2 | Post-commit launcher failure warns without undoing account; `commands/add.ts`, integration test | Applicable: baseline committed mutations can fail during sync with unclear state | Account remains committed; clear warning includes `cca sync` repair |
| P2 | New branches/error paths have behavior tests, portable fixtures; AGENTS and test suite | Applicable: baseline missing command/CLI/TUI failure tests and hardcoded `/tmp` usage fixtures | Temporary paths use `tmpdir`/`join`; mode assertions guarded on Windows; three-OS CI |
| P2 | Security dependency update; 0.2.2 changelog | Applicable principle, versions require independent assessment | Lockfile audit and compatible dependency checks |

Claude-specific adjacent reliability requirements: validate `--settings` as a plain object before any write; unique temporary files for settings/config/usage writes; validate statusline JSON roots and finite numeric percentages; avoid stale cached usage after token replacement. Codex has no direct statusline or usage-cache equivalent.

Already present at Claude baseline: newline-terminated visible prompts; non-TTY text-prompt rejection; scrubbed competing auth variables; isolated config plus stripped `oauthAccount`; shared skills/plugins/settings; token prefix validation; local hashed token detection; atomic rename writing; three-OS CI; per-account management actions.

Not directly applicable: Codex `auth.json` credential-store enforcement, `CODEX_HOME`, API-key/access-token/device-code/current-file import modes, SQLite/WAL inode checks, and `app-server-daemon`/`app-server-control` names. Preserve their isolation principles without transplanting Codex-specific runtime names. Reserved slug protection is needed only where Claude's launcher prefix can collide with an existing manager bin.

## UI implementation evidence

`src/ui/select.ts` now repaints in place, restores previous raw mode, removes data/end listeners, cancels a numbered menu on EOF, rejects partial numeric selections, and rejects closed confirmation/text input. `test/ui-select.test.ts` covers these paths (five focused tests pass). Full integrated checks are recorded below.

## Adaptations and verification scope

- Account mutation/preflight locks are short-lived, so multiple sessions may run
  concurrently under one account. Unlike Codex's lifetime lock, rename/removal
  does not wait for an already running child. The child keeps its injected token;
  perform account renames between sessions to keep config paths stable.
- Rename preserves the account config directory and refuses orphan destinations.
  Removal preserves config data; it removes registry/token/launcher state only.
  There is no durable multi-store transaction journal: rollback covers ordinary
  operation failures, while process termination between commits can leave orphan
  state requiring inspection. Orphan tokens/directories are not overwritten.
- Optional shared-entry symlinks remain best-effort where OS permissions prohibit
  creation. Managed identity/settings write failures abort launch.
- Statusline meters validate JSON and numeric ranges. Exact token matches and
  usage coincidences are separate advisory findings.
- Live Claude login/billing and native Windows execution require external
  verification; local tests use fake credentials and temporary data exclusively.

## Final local verification

- `npm run verify`: typecheck, 123 tests across 19 files, production bundle and
  exact CLI version 0.1.5 passed.
- `npm audit`: zero reported vulnerabilities.
- `npm pack --dry-run`: release file selection passed.
- POSIX subprocess fixture verified raw argv, isolated auth/config, and exit 7;
  macOS file-store fixture bypassed the Keychain without reading real credentials.
- Native Windows and live Claude billing remain unverified locally; three-OS CI
  is retained. Published runtime supports Node 18; development requires Node 20+.

## Agent ownership ledger

| Worker | Model | Owned outcome | Lead disposition |
| --- | --- | --- | --- |
| storage | gpt-6.1-sol | Registry/token locking, mirror safety, config-preserving rename | Reviewed and integrated with concurrency/rollback tests |
| launcher | gpt-6.1-sol | Paths, durable wrappers, launch preflight and signals | Reviewed and integrated with launcher/subprocess tests |
| parity_audit | gpt-6.1-sol | Comparison, independent review, UI and doctor integrity | Review findings fixed and tests integrated |
| lead | Parent session | CLI, command commits, settings, statusline, dependencies, artifact gates | Final tree verification owner |

Node 18 bundled CLI smoke passed. Extracted npm artifact ran without a
`node_modules` directory and reported the exact package version. Release 0.1.5 is prepared for GitHub and npm distribution. No real account
migration or credential operation was performed during verification.
