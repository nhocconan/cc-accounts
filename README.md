# cca — Claude Code multi-account switcher

Run **multiple Claude Code logins side by side** on one machine. `cca` creates
per-account launchers — `claude-work`, `claude-personal`, `claude-team` — that
each start Claude Code authenticated as a different subscription, with **correct
per-account billing isolation**.

Think of it as [`cc-mirror`](https://github.com/numman-ali/cc-mirror) but for
different Claude logins (not different providers), built on the proven
billing-isolation core of
[`claude-code-account-switcher`](https://github.com/claude-code-tools/claude-code-account-switcher).

```
$ cca add
Account display name: Work
Command suffix (without claude-) [work]:
Generating a one-year OAuth token for Work…
Paste the generated token: sk-ant-oat-…
Stored Work. Launch with: claude-work

$ claude-work        # ← Claude Code, billed to your Work subscription
$ claude-personal    # ← same machine, same terminal, different subscription
```

## Why

Claude Code pins the account/org cached in `~/.claude.json`'s `oauthAccount`
key onto **every** API request. So merely swapping an OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`)
isn't enough — Claude reads the cached org from disk and bills the **wrong plan**
(a 403, then a silent fallback to whatever you last logged in as).

`cca` fixes this: each account gets its own `CLAUDE_CONFIG_DIR` that **shares**
all of `~/.claude/*` (settings, plugins, skills, agents, memory, history) via
symlinks, but writes a fresh `.claude.json` with `oauthAccount` **stripped**.
With no cached org, Claude falls back to the org encoded in the injected token →
**correct billing**, nothing reconfigured.

## Install

**Requires:** Node.js 18+ and the `claude` CLI on your PATH.

### Option A — `npx` (no install, always latest)

```bash
npx claude-accounts add
```

### Option B — global install (recommended)

```bash
npm install -g claude-accounts
cca add
```

### Option C — from source

```bash
git clone <this-repo> cca && cd cca
npm install
npm run build
npm install -g .      # makes `cca` available globally
```

> **First run note:** `cca` installs per-account launchers (`claude-<slug>`)
> into a writable directory on your PATH (preferring `~/.local/bin`). If that
> directory isn't on your PATH yet, `cca` will tell you what to add to your
> shell config.

## Usage

### Interactive (easiest)

```bash
cca          # arrow-key picker: select an account → Launch / Edit / Refresh / Remove / Add
```

### Commands

| Command | Description |
|---|---|
| `cca` | Interactive account picker + actions (TUI) |
| `cca list` | List accounts with usage meters (`5h 42% · 7d 17% used`) |
| `cca add` | Register a new account (runs `claude setup-token`) |
| `cca refresh <slug>` | Replace an account's token |
| `cca remove <slug>` | Delete an account and its token |
| `cca edit <slug>` | Change label / slug / settings overrides |
| `cca launch <slug>` | Launch Claude as that account |
| `cca sync` | Rebuild launchers + refresh config dirs |
| `cca doctor` | Audit tokens, isolation, and same-account collisions |

**Or just run the launcher directly** — that's the whole point:

```bash
claude-work        # = cca launch work
claude-personal    # = cca launch personal
claude-work -p "fix this test"   # args pass through to claude verbatim
```

### Adding an account

```bash
# Interactive (recommended) — runs `claude setup-token` to generate a token
cca add

# Fully headless — token from a flag or CLAUDE_CODE_OAUTH_TOKEN env var
cca add --name "Work" --slug work --token sk-ant-oat-…
```

The token is bound to whichever account is **signed in on claude.ai in your
browser** at the moment you generate it. Switch to the intended account on
claude.ai first, then confirm in the browser tab that opens.

### Per-account settings overrides (Hybrid mode)

By default every account **shares** your base `~/.claude/settings.json`,
plugins, skills, agents, and memory (so nothing is reconfigured). You can also
give a specific account its own settings overrides — useful for pinning a model
or setting per-account env vars:

```bash
# Pin a different model + an extra env var for one account
cca add --name "Cheap" --slug cheap --token … \
  --settings '{"model":"haiku","env":{"MAX_THINKING_TOKENS":"4096"}}'

# Deep-merged: base settings win where you don't override; you win where you do
cca edit personal --settings '{"model":"sonnet-4"}'

# Clear overrides (back to pure shared)
cca edit personal --settings clear
```

The override is **deep-merged** onto your base settings at launch, so e.g.
`env` objects combine rather than replace.

## How it works

```
~/.claude-accounts/                      ← cca's own data (overridable: CLAUDE_ACCOUNTS_DIR)
├── accounts.json                        ← registry: {slug, label, service, overrides} (NO tokens)
├── configs/<slug>/                      ← per-account CLAUDE_CONFIG_DIR
│   ├── .claude.json                     ←   REAL file, oauthAccount STRIPPEN ← billing isolation
│   ├── settings.json                    ←   symlink to base (or merged file if overrides)
│   ├── plugins/  skills/  agents/  ...  ←   symlinks to ~/.claude/* (shared)
│   └── (daemon*, *.lock, *.sock absent) ←   per-process state NOT shared
├── usage/<slug>.json                    ← cached rate_limits (for list/doctor)
└── tokens.json                          ← Linux/Windows credstore (0600); macOS uses Keychain

~/.local/bin/claude-work → cca binary    ← busybox symlink (dispatches on its own name)
```

**Launch flow** (`claude-work` → `cca`):

1. Read the account's OAuth token from **macOS Keychain** (or `tokens.json` on
   Linux/Windows).
2. **Rebuild** `~/.claude-accounts/configs/work/`: refresh `~/.claude/*` symlinks,
   write a stripped `.claude.json`, write a merged `settings.json` if overrides.
3. **Spawn `claude`** with `stdio: inherit`, scrubbing competing auth vars
   (`ANTHROPIC_API_KEY`, `_AUTH_TOKEN`, `_BASE_URL`, Bedrock/Vertex/Foundry flags)
   and injecting `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, and the account
   slug/label. Signals are relayed; claude's exit code is propagated.

Every launch is **always fresh** — current global settings, current token,
current overrides — with ~50ms of Node overhead (invisible vs claude's startup).

### Status line

`cca` registers itself as Claude's status-line command, so each session shows
which account it's using plus live usage, in-session:

```
Work  ·  5h 42% · 7d 17%
```

The usage is also cached so `cca list` and `cca doctor` can show meters without
a running session.

### Doctor

```bash
cca doctor
```

Audits each account: is the token present and correctly prefixed? Are any two
accounts sharing one token or one usage fingerprint? (That's the classic symptom
of a token generated while signed into the wrong account on claude.ai — both
"accounts" silently bill the same subscription.)

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_ACCOUNTS_DIR` | `~/.config/claude-accounts` | Root for all cca data |
| `CLAUDE_ACCOUNTS_BIN_DIR` | first writable PATH dir (prefers `~/.local/bin`) | Where `claude-<slug>` launchers go |
| `CLAUDE_ACCOUNTS_NAME_SESSIONS` | (unset) | Set to `1` to name sessions after the account |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Used by `cca add`/`refresh` as a headless token source |

## Security

- Tokens live **only** in the OS credential store: macOS Keychain on mac,
  a `0600` `tokens.json` elsewhere. Never in the registry, never in launchers,
  never logged.
- Competing auth env vars are scrubbed before launching claude, so subprocesses,
  hooks, and MCP servers can't inherit a different account's credentials.
- `cca doctor` is read-only and never contacts Anthropic.

## Development

```bash
npm install          # dev deps only (typescript, tsup, vitest, tsx)
npm test             # 28 unit tests across registry, isolation, settings, credstore, usage
npm run typecheck    # tsc --noEmit
npm run build        # tsup → single bundled dist/cli.js (zero runtime deps)
npm run dev -- list  # run from source via tsx
```

The codebase is pure TypeScript with **zero runtime dependencies** — the
published `dist/cli.js` is a single ~40KB self-contained ESM bundle.

## Credits

Built on the excellent work of:
- [`claude-code-account-switcher`](https://github.com/claude-code-tools/claude-code-account-switcher)
  — the billing-isolation core (`.claude.json` `oauthAccount` strip + symlinked
  config dir), credential store, usage meter, and doctor concept.
- [`cc-mirror`](https://github.com/numman-ali/cc-mirror) — the npm/`npx`
  distribution model and polished launcher DX.

## License

MIT © Tien Le
