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
#   1. Current branch is `main`, except for the one pinned 1.0.5 maintenance
#      branch used to patch the public App Store binary.
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

RUNTIME105_BRANCH="codex/runtime105-livefix"
RUNTIME105_BASELINE="de9ded1862a57326c9324c5d2ef54f5eb03e61ae"
expected_branch="${WASHEDUP_OTA_EXPECTED_BRANCH:-main}"

fail() {
  echo "" >&2
  echo "✋ OTA publish BLOCKED: $1" >&2
  echo "   (run scripts/ota-guard.sh after fixing, or publish via npm run ota:ios / ota:android)" >&2
  exit 1
}

# 1. Must be on main, or the explicitly selected and pinned 1.0.5 branch.
if [ "$expected_branch" != "main" ] && [ "$expected_branch" != "$RUNTIME105_BRANCH" ]; then
  fail "unsupported expected branch '$expected_branch'."
fi

branch="$(git branch --show-current)"
if [ "$branch" != "$expected_branch" ]; then
  fail "you are on '$branch', not the required '$expected_branch' branch."
fi

# 2. Working tree must be clean.
if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted/untracked changes:" >&2
  git status -s >&2
  fail "working tree is dirty. Commit or stash so the OTA matches main HEAD."
fi

# 2b. HEAD must match the same online branch. The publish ships the working tree,
#     and a second work lane can stack unpushed (held, unreviewed) commits on
#     local main between your own HEAD check and the publish. That exact miss
#     shipped the held 7-31 commit set to iOS production (rolled back within
#     minutes). Fetch first so the comparison uses the real remote, not a
#     stale ref. Flow consequence: push main, then publish, in that order.
git fetch origin "$expected_branch" --quiet || fail "could not fetch origin/$expected_branch to verify HEAD (offline?)."
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$expected_branch")" ]; then
  echo "local $expected_branch:  $(git rev-parse --short HEAD)" >&2
  echo "origin/$expected_branch: $(git rev-parse --short "origin/$expected_branch")" >&2
  fail "$expected_branch HEAD does not match origin/$expected_branch. Push or park the extra commits, then publish."
fi

# 2c. The public store is still on runtime 1.0.5. Its maintenance branch is
# intentionally frozen to the last known-good 1.0.5 production OTA, and only
# this reviewed UI/chat patch plus these two release scripts may differ.
if [ "$expected_branch" = "$RUNTIME105_BRANCH" ]; then
  git cat-file -e "${RUNTIME105_BASELINE}^{commit}" 2>/dev/null \
    || fail "the pinned 1.0.5 baseline is missing locally."
  git merge-base --is-ancestor "$RUNTIME105_BASELINE" HEAD \
    || fail "HEAD is not descended from the pinned 1.0.5 production baseline."
  if [ "$(git rev-list --count "$RUNTIME105_BASELINE"..HEAD)" != "1" ]; then
    fail "the 1.0.5 maintenance release must be exactly one reviewed commit above its baseline."
  fi
  if [ "$(node -p "require('./app.json').expo.version" 2>/dev/null || true)" != "1.0.5" ]; then
    fail "the 1.0.5 maintenance branch no longer declares app version 1.0.5."
  fi
  if ! grep -q "policy: 'appVersion'" app.config.js; then
    fail "the 1.0.5 maintenance branch no longer uses the appVersion runtime policy."
  fi
  while IFS= read -r changed_path; do
    case "$changed_path" in
      "app/(creator)/events.tsx"|\
      "app/(tabs)/plans/index.tsx"|\
      "app/+native-intent.tsx"|\
      "app/community-thread/[id].tsx"|\
      "app/community-topic/[id].tsx"|\
      "app/creator/event-form.tsx"|\
      "app/creator/payouts.tsx"|\
      "app/event/[id].tsx"|\
      "app/plan/[id].tsx"|\
      "components/communities/CommunityMessageActions.tsx"|\
      "lib/creatorEvents.ts"|\
      "lib/fetchPlans.ts"|\
      "lib/planTime.ts"|\
      "lib/sceneDiscovery.ts"|\
      "lib/ticketing.ts"|\
      "scripts/ota-guard.sh"|\
      "scripts/publish-runtime105-ota.sh") ;;
      *) fail "unapproved 1.0.5 maintenance change: $changed_path" ;;
    esac
  done < <(git diff --name-only "$RUNTIME105_BASELINE"..HEAD)
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

# Warn (don't block) on source-referenced EXPO_PUBLIC_ vars not set anywhere —
# these have shipped unset in every bundle to date; add them to .env.local to
# promote them to hard-gated.
for var in $(grep -rhoE 'EXPO_PUBLIC_[A-Z0-9_]+' app components hooks lib constants 2>/dev/null | sort -u); do
  if [ -z "${!var:-}" ]; then
    echo "⚠️  $var is referenced in source but unset — it will bake into the bundle as empty." >&2
  fi
done

echo "OTA guard passed: branch=$expected_branch, commit=$(git rev-parse --short HEAD), tree clean, online branch matched, environment keys present."
