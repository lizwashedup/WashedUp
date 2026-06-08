#!/usr/bin/env bash
#
# publish-ota.sh <ios|android> "<message>" — run the guard, then publish a
# production OTA for one platform.
#
# Per-platform on purpose: the web bundle is broken and OTAs must target one
# platform at a time (see project notes). Use this instead of raw `eas update`
# so the ota-guard checks can never be skipped.
#
#   ./scripts/publish-ota.sh ios "fix(auth): OTP cells responsive"
#
# Or via npm:  npm run ota:ios -- "fix(auth): ..."

set -euo pipefail

cd "$(dirname "$0")/.."

platform="${1:-}"
message="${2:-}"

if [ "$platform" != "ios" ] && [ "$platform" != "android" ]; then
  echo "Usage: $0 <ios|android> \"<message>\"" >&2
  exit 2
fi
if [ -z "$message" ]; then
  echo "A non-empty update message is required." >&2
  echo "Usage: $0 <ios|android> \"<message>\"" >&2
  exit 2
fi

# Hard gate — aborts on wrong branch, dirty tree, or forbidden native imports.
bash "$(dirname "$0")/ota-guard.sh"

echo ""
echo "Publishing production OTA → platform=$platform"
echo "  message: $message"
echo ""

npx eas-cli update --branch production --platform "$platform" --message "$message"
