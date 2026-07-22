#!/usr/bin/env bash
# Release cc-accounts to npm.
#
#   ./scripts/release.sh patch     0.1.0 -> 0.1.1
#   ./scripts/release.sh minor     0.1.0 -> 0.2.0
#   ./scripts/release.sh major     0.1.0 -> 1.0.0
#   ./scripts/release.sh 0.4.2     explicit version
#   DRY=1 ./scripts/release.sh patch    rehearse, publish nothing
#
# npm 2FA is passkey-based, so `npm publish` needs a real TTY to open the
# browser. Run this from Terminal, not from inside an agent/CI shell — or set
# a granular access token first (see README) and it publishes unattended.

set -euo pipefail
cd "$(dirname "$0")/.."

BUMP="${1:-patch}"
DRY="${DRY:-0}"
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mx\033[0m %s\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
[ -t 1 ] || [ "$DRY" = 1 ] || \
  say "warning: not a TTY — passkey 2FA may fail. Use a real terminal."

[ -z "$(git status --porcelain)" ] || die "working tree is dirty — commit or stash first."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = master ] || die "on branch '$BRANCH' — release from master."

say "checking npm auth"
WHO="$(npm whoami 2>/dev/null)" || die "not logged in — run: npm login --auth-type=web"
say "publishing as $WHO"

git fetch --quiet origin master
LOCAL="$(git rev-parse @)"; REMOTE="$(git rev-parse @{u} 2>/dev/null || echo "$LOCAL")"
[ "$LOCAL" = "$REMOTE" ] || die "local master differs from origin — pull/push first."

# --- gates -------------------------------------------------------------------
say "typecheck"; npm run typecheck
say "test";      npm test
say "build";     npm run build
[ -f dist/cli.js ] || die "dist/cli.js missing after build."
head -1 dist/cli.js | grep -q '^#!' || die "dist/cli.js lost its shebang — bin would not run."

# --- version -----------------------------------------------------------------
OLD="$(node -p "require('./package.json').version")"
if [ "$DRY" = 1 ]; then
  say "DRY RUN — current $OLD, would bump '$BUMP'"
  # `npm publish --dry-run` errors on an already-published version, so pack
  # instead: same file-selection logic, no registry round-trip.
  npm pack --dry-run
  say "dry run complete. Nothing published, nothing bumped."
  exit 0
fi

say "bumping $OLD ($BUMP)"
npm version "$BUMP" -m "Release v%s"   # commits + tags v<new>
NEW="$(node -p "require('./package.json').version")"

# --- publish -----------------------------------------------------------------
say "publishing cc-accounts@$NEW"
if ! npm publish --access public; then
  say "publish failed — rolling back the local bump so you can retry cleanly"
  git tag -d "v$NEW" >/dev/null 2>&1 || true
  git reset --hard HEAD~1
  die "publish failed. Tree restored to v$OLD."
fi

say "pushing commit + tag"
git push origin master --follow-tags

say "verifying registry"
for _ in 1 2 3 4 5 6; do
  [ "$(npm view cc-accounts version 2>/dev/null)" = "$NEW" ] && break
  sleep 5
done
[ "$(npm view cc-accounts version 2>/dev/null)" = "$NEW" ] \
  || die "registry still not serving $NEW — check npmjs.com."

say "done: cc-accounts@$NEW  →  npx cc-accounts@$NEW add"
