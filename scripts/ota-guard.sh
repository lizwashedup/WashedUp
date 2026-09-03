#!/usr/bin/env bash
#
# ota-guard.sh — pre-publish safety gate for production OTA updates.
#
# Background (2026-05-27/28 incident): an `eas update` was published to runtime
# 1.0.4 from a tree carrying native modules (expo-audio / Giphy) that the 1.0.4
# App Store binary doesn't contain. Because runtimeVersion.policy is "appVersion"
# (app.config.js), that OTA was still stamped "1.0.4" and got served to the live
# binary, which crashed on launch with "Cannot find native module 'ExpoAudio'".
# A prior "branch gate" only printed the branch and continued, so it didn't stop
# the bad publish (the be08e8f9 accidental chat-tree publish).
#
# This guard HARD-EXITS unless all of the following hold. Run it (or one of the
# `ota:*` package.json scripts that wrap it) before every production OTA.
#
#   1. Current branch is `main`.
#   2. Working tree is clean (no uncommitted/untracked changes) — so what you
#      publish is exactly the committed `main` HEAD.
#   3. No tracked source imports a native module known to be absent from the
#      shipped binary. Metro bundles by import graph, so this is the real signal:
#      even with those packages installed in node_modules, the OTA is only unsafe
#      if some `app/components/hooks/lib` source actually imports them.
#
# Layer-2 structural fix (not done here): switch runtimeVersion.policy to
# "fingerprint" so EAS refuses to serve a native-incompatible OTA at all. That
# must land with the next EAS build and is tracked separately.

set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "" >&2
  echo "✋ OTA publish BLOCKED: $1" >&2
  echo "   (run scripts/ota-guard.sh after fixing, or publish via npm run ota:ios / ota:android)" >&2
  exit 1
}

# 1. Must be on main.
branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  fail "you are on '$branch', not 'main'. Production OTAs ship from main only."
fi

# 2. Working tree must be clean.
if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted/untracked changes:" >&2
  git status -s >&2
  fail "working tree is dirty. Commit or stash so the OTA matches main HEAD."
fi

# 2b. main HEAD must match origin/main. The publish ships the working tree,
#     and a second work lane can stack unpushed (held, unreviewed) commits on
#     local main between your own HEAD check and the publish. That exact miss
#     shipped the held 7-31 commit set to iOS production (rolled back within
#     minutes). Fetch first so the comparison uses the real remote, not a
#     stale ref. Flow consequence: push main, then publish, in that order.
git fetch origin main --quiet || fail "could not fetch origin/main to verify HEAD (offline?)."
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "local main:  $(git rev-parse --short HEAD)" >&2
  echo "origin/main: $(git rev-parse --short origin/main)" >&2
  fail "main HEAD does not match origin/main. Push or park the extra commits, then publish."
fi

# 3. No tracked source may import native modules missing from the live binary.
#    Keep this denylist in sync with what the *shipped* binary actually bundles;
#    anything added here needs a new EAS build, not an OTA.
#    2026-07-05: the live 1.0.5 binary was built from this trunk WITH expo-audio
#    and the Giphy SDK (chat upgrade), so the old 1.0.4-era entries came off.
#    When a new native dependency lands ahead of its EAS build, add it here.
FORBIDDEN=''
if [ -n "$FORBIDDEN" ] && git grep -nE "$FORBIDDEN" -- app components hooks lib >/dev/null 2>&1; then
  echo "Forbidden native-module imports in tracked source:" >&2
  git grep -nE "$FORBIDDEN" -- app components hooks lib >&2
  fail "source imports native modules not in the live binary. These require a new EAS build."
fi

# 4. Every EXPO_PUBLIC_ var pinned in .env.local must be non-empty once loaded.
#    EXPO_PUBLIC_ values are inlined into the JS bundle at export time, so a
#    publish from a shell missing one ships it as empty string. That exact miss
#    (the 2026-06-30 splash OTA, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) killed
#    composer place search in prod for four days. .env.local is the machine's
#    pin list: if a key is declared there, an empty value is always a mistake.
if [ ! -f .env.local ]; then
  fail ".env.local is missing — EXPO_PUBLIC_ values would bake into the bundle as empty strings."
fi
set -a; . ./.env.local; set +a
while IFS= read -r var; do
  if [ -z "${!var:-}" ]; then
    fail "$var is declared in .env.local but empty — it would ship baked-in as ''."
  fi
done < <(grep -oE '^EXPO_PUBLIC_[A-Z0-9_]+' .env.local)

# 5. Every EXPO_PUBLIC_ var live in EAS's real "production" environment must
#    also be declared in .env.local. `eas update` bundles from THIS shell's
#    env, not from EAS's server-side environment the way `eas build` does --
#    a var can be correctly set for the real native build and silently absent
#    here, so an OTA published from this machine ships it empty even though
#    the installed binary shipped it real. Unlike check 4 above (declared but
#    blank), this catches a var that's missing from .env.local entirely.
#    2026-09-02 incident: EXPO_PUBLIC_COMMUNITIES_ENABLED,
#    EXPO_PUBLIC_JOIN_GATE_ENABLED, and EXPO_PUBLIC_ADMIN_USER_IDS were all
#    live in EAS production but absent from .env.local -- three straight OTAs
#    silently turned Communities (and the join gate, and admin access) off in
#    production before Liz caught it and it got traced back to this gap.
# `while read <<<` here, not `for var in $eas_prod_vars` -- an unquoted
# multi-line expansion in a `for` only splits into separate words under a
# shell that word-splits by default (real bash does; this repo's dev shells
# include zsh, which does NOT unless SH_WORD_SPLIT is set). Under zsh, a
# `for`-over-unquoted-multiline collapses to ONE iteration with the whole
# blob as $var, and the grep below spuriously "finds" it against the last
# real line in .env.local -- so the check silently never fires. `read` splits
# on lines regardless of shell, so this stays correct under both.
eas_prod_vars="$(npx eas-cli env:list production --format short 2>/dev/null | grep -oE '^EXPO_PUBLIC_[A-Z0-9_]+' || true)"
if [ -z "$eas_prod_vars" ]; then
  echo "⚠️  could not read EAS's production environment (offline, or eas-cli auth expired) — skipping the drift check against .env.local. Run 'npx eas-cli env:list production' by hand if you don't trust this OTA's flags." >&2
else
  missing=""
  while IFS= read -r var; do
    [ -z "$var" ] && continue
    if ! grep -qE "^${var}=" .env.local; then
      missing="$missing
$var"
    fi
  done <<< "$eas_prod_vars"
  if [ -n "$missing" ]; then
    echo "EAS production has these set, but .env.local doesn't declare them at all:" >&2
    while IFS= read -r var; do
      [ -z "$var" ] && continue
      echo "  $var" >&2
    done <<< "$missing"
    fail "the vars above are live in EAS's production environment but missing from .env.local — this OTA would silently ship them empty even though the real binary has them set. Add them to .env.local with the real value (check: npx eas-cli env:list production) before publishing."
  fi
fi

# Warn (don't block) on source-referenced EXPO_PUBLIC_ vars not set anywhere —
# these have shipped unset in every bundle to date; add them to .env.local to
# promote them to hard-gated.
for var in $(grep -rhoE 'EXPO_PUBLIC_[A-Z0-9_]+' app components hooks lib constants 2>/dev/null | sort -u); do
  if [ -z "${!var:-}" ]; then
    echo "⚠️  $var is referenced in source but unset — it will bake into the bundle as empty." >&2
  fi
done

echo "✅ OTA guard passed — on main, clean tree, HEAD matches origin/main, commit $(git rev-parse --short HEAD), no forbidden native imports, .env.local keys all non-empty."
