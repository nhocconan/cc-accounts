<div align="center">

# `cca` — Claude Code multi-account switcher

Run **multiple Claude Code logins side by side** on one machine.

Each account gets its own launcher — `claude-work`, `claude-personal`,
`claude-team` — that starts Claude Code authenticated as a different
subscription, with **correct per-account billing isolation**.

[Install](#-install) · [Quick start](#-quick-start) · [How it works](#-how-it-works) · [Commands](#-commands) · [FAQ](#-faq)

</div>

---

Think of it as [`cc-mirror`](https://github.com/numman-ali/cc-mirror) but for
different **Claude logins** (not different providers), built on the proven
billing-isolation core of
[`claude-code-account-switcher`](https://github.com/claude-code-tools/claude-code-account-switcher).

```bash
$ cca add                     # register an account (runs claude setup-token)
Account display name: Work
Command suffix (without claude-) [work]:
Generating a one-year OAuth token for Work…
Paste the generated token: sk-ant-oat-…
Stored Work. Launch with: claude-work

$ claude-work                 # ← Claude Code, billed to your Work subscription
$ claude-personal             # ← same machine, same terminal, different subscription
```

## 🤔 Why this exists

Claude Code pins the account/org cached in `~/.claude.json`'s `oauthAccount`
key onto **every** API request. So merely swapping an OAuth token
(`CLAUDE_CODE_OAUTH_TOKEN`) isn't enough — Claude reads the cached org from
disk and bills the **wrong plan** (a 403, then a silent fallback to whatever
you last logged in as).

`cca` fixes this properly. Each account gets its own `CLAUDE_CONFIG_DIR` that
**shares** all of `~/.claude/*` (settings, plugins, skills, agents, memory,
history) via symlinks, but writes a fresh `.claude.json` with `oauthAccount`
**stripped**. With no cached org, Claude falls back to the org encoded in the
injected token → **correct billing, nothing reconfigured**.

## 📦 Install

**Requires:** Node.js 18+ and the `claude` CLI on your PATH.

### Option A — `npx` (recommended: nothing to install, nothing to update)

```bash
npx cc-accounts add
```

`npx` fetches the current release each time, so there is no update step and no
stale version to chase. This is the recommended way to run one-off commands
(`add`, `list`, `doctor`).

> **If `npx` seems to run an old version**, its cache keys on the package
> *name*, not the version. Pin it once to refresh:
> ```bash
> npx --yes cc-accounts@latest add
> ```

### Option B — global install (needed for the `claude-<slug>` launchers)

```bash
npm install -g cc-accounts
cca add
```

The per-account launchers (`claude-work`, `claude-personal`, …) are symlinks
that point at the `cca` binary. `npx` installs into a temporary cache that npm
may clean up, so those launchers only keep working if `cca` is on your PATH for
good. **Run at least one global install if you want the `claude-<slug>`
commands.** Everything else works fine under `npx` alone.

### Option C — from source

```bash
git clone https://github.com/nhocconan/cc-accounts.git
cd cc-accounts
npm install
npm run build
npm install -g .        # makes `cca` available globally
```

> **First-run note:** `cca` installs per-account launchers (`claude-<slug>`)
> into a writable directory on your PATH (preferring `~/.local/bin`). If that
> directory isn't on your PATH yet, `cca` will tell you exactly what to add to
> your shell config (~/.zshrc or ~/.bashrc):
> ```bash
> export PATH="$HOME/.local/bin:$PATH"
> ```

### Updating

| Installed via | Update with |
|---|---|
| `npx` | **nothing to do** — each run fetches the current release. If it looks stale: `npx --yes cc-accounts@latest …` |
| `npm install -g` | `npm update -g cc-accounts` (or `npm install -g cc-accounts@latest`) |
| from source | `git pull && npm install && npm run build && npm install -g .` |

Updating never touches your accounts: tokens stay in the Keychain (or
`tokens.json`) and the registry stays in `~/.config/claude-accounts`. After
updating a global install, run `cca sync` to refresh the launchers.

### Updating Claude Code itself

Nothing to do — every launcher always runs your current `claude`.

`cca` never pins, copies, or caches a Claude version. Each `claude-<slug>`
launch resolves `claude` from your `PATH` at that moment and execs it, so the
instant Claude Code updates itself (or you update it), every account picks the
new build up on its next launch. The registry stores only
`slug`/`label`/`service`/`createdAt` — no binary path.

The same holds for everything under `~/.claude` (plugins, skills, agents,
settings, memory): each account's config dir symlinks to it, so an update there
lands for all accounts at once. Only `.claude.json` is written per account, to
strip `oauthAccount`.

> If several `claude` binaries are on your `PATH` (npm global, `~/.local/bin`,
> Homebrew), `cca` takes the first one — the same one plain `claude` would run.
> `cca doctor` reports which.

## 🚀 Quick start

```bash
# 1. Add your first account (interactive — runs `claude setup-token`)
cca add

# 2. Add a second account
cca add

# 3. List them with live usage meters
cca list
#   claude-work            Work                            5h 42% · 7d 17% used
#   claude-personal        Personal                        5h 8% · 7d 2% used

# 4. Launch either one directly
claude-work
claude-personal
```

**That's it.** Each `claude-<slug>` is a standalone command — use it anywhere
you'd use `claude`, and all args pass through verbatim:

```bash
claude-work -p "fix this test"          # one-shot prompt
claude-work --resume                    # resume a Work session
claude-personal cd ~/projects/blog      # run in a specific dir
```

## 🎯 Adding an account

When you run `cca add`, it launches `claude setup-token`, which opens a browser
tab to generate a **one-year OAuth token**. **Important:** the token is bound to
whichever account is **signed in on claude.ai in your browser** at that moment.
So:

1. Go to [claude.ai](https://claude.ai) and **switch to the account** you want
   this launcher to use (e.g. your Work login).
2. Run `cca add`.
3. Confirm in the browser tab that opens.
4. Paste the generated token (`sk-ant-oat-…`) back into the terminal.

```bash
# Interactive (recommended)
cca add

# Fully headless — token from a flag or CLAUDE_CODE_OAUTH_TOKEN env var
cca add --name "Work" --slug work --token sk-ant-oat-…

# With per-account settings overrides (see Hybrid mode below)
cca add --name "Cheap" --slug cheap --token … \
  --settings '{"model":"haiku","env":{"MAX_THINKING_TOKENS":"4096"}}'
```

## 🧬 Per-account settings overrides (Hybrid mode)

By default every account **shares** your base `~/.claude/settings.json`,
plugins, skills, agents, and memory — so nothing needs reconfiguring. You can
also give a specific account its own overrides:

```bash
# Pin a different model + extra env var for one account
cca edit personal --settings '{"model":"sonnet-4","env":{"PERSONAL_API":"v2"}}'

# Clear overrides (back to pure shared)
cca edit personal --settings clear
```

The override is **deep-merged** onto your base settings at launch — so `env`
objects combine rather than replace. Example: base `{"env":{"A":"1"}}` +
override `{"env":{"B":"2"}}` → `{"env":{"A":"1","B":"2"}}`.

## 📋 Commands

| Command | Description |
|---|---|
| `cca` | Interactive account picker + actions (arrow-key TUI) |
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
claude-work            # = cca launch work
claude-work -p "..."   # any claude args pass through verbatim
```

## 🔧 How it works

```
~/.claude-accounts/                      ← cca's own data (CLAUDE_ACCOUNTS_DIR)
├── accounts.json                        ← registry: {slug, label, service, overrides}  (NO tokens)
├── configs/<slug>/                      ← per-account CLAUDE_CONFIG_DIR
│   ├── .claude.json                     ←   REAL file, oauthAccount STRIPPED  ← billing isolation
│   ├── settings.json                    ←   symlink to base, OR merged file if overrides set
│   ├── plugins/  skills/  agents/  ...  ←   symlinks to ~/.claude/*  (shared)
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

The usage is also cached so `cca list` and `cca doctor` show meters without a
running session.

### Doctor

```bash
cca doctor
```

Audits each account: is the token present and correctly prefixed? Are any two
accounts sharing one token or one usage fingerprint? (That's the classic symptom
of a token generated while signed into the wrong account on claude.ai — both
"accounts" silently bill the same subscription.)

```
Claude accounts doctor

  config isolation: per-account CLAUDE_CONFIG_DIR (.claude.json oauthAccount stripped)
  claude binary   : /Users/you/.local/bin/claude
  cca binary      : /usr/local/bin/cca

● Work  (claude-work)
    token : present (OAuth setup-token)
    usage : 5h 42% · 7d 17% used

✓ No problems detected.
```

The `claude binary` line is resolved fresh each run, so it also tells you which
Claude install your launchers will exec if you have more than one.

## ⚙️ Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_ACCOUNTS_DIR` | `~/.config/claude-accounts` | Root for all cca data |
| `CLAUDE_ACCOUNTS_BIN_DIR` | first writable PATH dir (prefers `~/.local/bin`) | Where `claude-<slug>` launchers go |
| `CLAUDE_ACCOUNTS_NAME_SESSIONS` | (unset) | Set to `1` to name sessions after the account |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Used by `cca add`/`refresh` as a headless token source |

## 🔒 Security

- Tokens live **only** in the OS credential store: macOS Keychain on mac, a
  `0600` `tokens.json` elsewhere. Never in the registry, never in launchers,
  never logged.
- Competing auth env vars are scrubbed before launching claude, so subprocesses,
  hooks, and MCP servers can't inherit a different account's credentials.
- `cca doctor` is read-only and never contacts Anthropic.

## 🛠️ Development

```bash
npm install          # dev deps only (typescript, tsup, vitest, tsx)
npm test             # 28 unit tests: registry, isolation, settings, credstore, usage
npm run typecheck    # tsc --noEmit
npm run build        # tsup → single bundled dist/cli.js (zero runtime deps)
npm run dev -- list  # run from source via tsx
```

The codebase is pure TypeScript with **zero runtime dependencies** — the
published `dist/cli.js` is a single ~40KB self-contained ESM bundle.

### Project structure

```
src/
├── cli.ts                # entry: argv parse + busybox dispatch (claude-<slug> → launch)
├── tui.ts                # interactive account picker
├── core/
│   ├── paths.ts          # all path/env resolution
│   ├── registry.ts       # accounts.json read/write + slug validation
│   ├── credstore*.ts     # macOS Keychain / Linux+Windows tokens.json
│   ├── isolation.ts      # ⭐ per-account CLAUDE_CONFIG_DIR + oauthAccount strip
│   ├── settings.ts       # deep-merge base settings + overrides
│   ├── launcher.ts       # env scrub + token inject + spawn claude
│   ├── usage.ts          # cached rate-limit summaries + fingerprints
│   └── wrappers.ts       # claude-<slug> symlink create/prune
├── commands/             # list, add, refresh, remove, edit, launch, doctor, sync, statusline
└── ui/select.ts          # zero-dep arrow-key picker (fzf/numbered fallbacks)
test/                     # 28 unit tests
```

## ❓ FAQ

<details>
<summary><b>Do I need a separate Claude subscription for each account?</b></summary>

No — you can use this with one subscription (e.g. to separate Work/Personal
contexts with different settings) or with multiple subscriptions (the main use
case). The billing isolation is correct either way: each launcher bills the
account whose token it carries.
</details>

<details>
<summary><b><code>/status</code> shows no account, just <code>Auth token: CLAUDE_CODE_OAUTH_TOKEN</code>. Is it broken?</b></summary>

No — that is the mechanism working, and it is the single most important thing
to understand about this tool.

Claude Code's account panel renders the `oauthAccount` object cached in
`.claude.json`. `cca` **deliberately strips that key** from each account's
config dir, because Claude pins the cached org onto every API request and would
otherwise bill the wrong plan no matter which token you inject. With no cached
org, Claude falls back to the org encoded in the token itself.

So a blank account panel means isolation is active. **Seeing a real account
there would be the bug** — it would mean a stale org is still cached and your
requests are being billed to it.

To confirm which account a session is actually using, use the pieces built for
it:

```bash
cca doctor        # per-account token + usage audit
cca list          # all accounts with usage meters
```

plus the in-session status line (`Work · 5h 42% · 7d 17%`), which `cca` passes
to Claude at launch via `--settings`. That is why `/status` lists
`Setting sources: … Command line arguments`.
</details>

<details>
<summary><b>Am I being billed per token? I see token-based pricing.</b></summary>

If you added the account with `cca add`, no — you are on your subscription.

Two ways to check:

```bash
# 1. Token type
cca doctor
#    token : present (OAuth setup-token)      ← subscription
```

An `sk-ant-oat…` token comes from `claude setup-token` and bills your Claude
subscription. An `sk-ant-api…` key is an API key and *does* bill per token —
`cca` rejects those at `add` time.

```bash
# 2. Rate-limit windows
cca list
#    claude-work   Work   5h 24% · 7d 8% used
```

Those 5-hour / 7-day windows only exist on subscription plans. Pay-per-token API
billing has no such window — it just meters tokens. If you see them, you are on
the subscription.

Any dollar figure Claude Code displays is its **generic token-cost estimator**,
shown regardless of how you authenticate. It is informational, not a charge
against a card.
</details>

<details>
<summary><b>What's the difference from <code>cc-mirror</code>?</b></summary>

`cc-mirror` creates isolated Claude Code variants pointed at **different
providers** (Z.ai, MiniMax, OpenRouter, …). `cca` is for switching between
**different Claude logins/subscriptions** on the *same* provider (Anthropic),
so you can run your Work and Personal Claude Pro/Max plans side by side.
</details>

<details>
<summary><b>Will my plugins / skills / settings be shared across accounts?</b></summary>

Yes, by default — they're symlinked from `~/.claude/`. That's the point: you
configure once, all accounts benefit. Use per-account `--settings` overrides if
you want an account to differ (e.g. a cheaper model for throwaway tasks).
</details>

<details>
<summary><b>I'm getting "unknown account" when I run <code>claude-work</code></b></summary>

Run `cca sync` — it rebuilds the `claude-<slug>` launchers from your registry.
This happens automatically after `add`/`edit`/`remove`, but if you restored
your config from backup or moved machines, `cca sync` fixes it.
</details>

<details>
<summary><b>How do I update <code>cca</code> itself?</b></summary>

If you run it with `npx`, there is nothing to update — every invocation pulls
the current release. Otherwise see [Updating](#updating):

```bash
npm update -g cc-accounts                       # global install
git pull && npm run build && npm install -g .   # from source
cca sync                                        # refresh launchers afterwards
```
</details>

<details>
<summary><b>How do I uninstall?</b></summary>

```bash
cca list                    # note your slugs
cca remove work             # repeat for each (deletes token + launcher)
npm uninstall -g cc-accounts
rm -rf ~/.claude-accounts   # the config dir (optional, if you want a clean slate)
```
</details>

## 🙏 Credits

Built on the excellent work of:
- [`claude-code-account-switcher`](https://github.com/claude-code-tools/claude-code-account-switcher)
  — the billing-isolation core (`.claude.json` `oauthAccount` strip + symlinked
  config dir), credential store, usage meter, and doctor concept.
- [`cc-mirror`](https://github.com/numman-ali/cc-mirror) — the npm/`npx`
  distribution model and polished launcher DX.

## 📄 License

MIT © Tien Le
