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

# 3. No tracked source may import native modules missing from the 1.0.4 binary.
#    Keep this denylist in sync with what the *shipped* binary actually bundles;
#    anything added here needs a new EAS build, not an OTA.
FORBIDDEN='expo-audio|giphy-react-native-sdk|@giphy|GiphySDK|RTNGiphy'
if git grep -nE "$FORBIDDEN" -- app components hooks lib >/dev/null 2>&1; then
  echo "Forbidden native-module imports in tracked source:" >&2
  git grep -nE "$FORBIDDEN" -- app components hooks lib >&2
  fail "source imports native modules not in the 1.0.4 binary. These require a new EAS build."
fi

echo "✅ OTA guard passed — on main, clean tree, commit $(git rev-parse --short HEAD), no forbidden native imports."
