#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NATIVE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
WEB_ROOT=$(CDPATH= cd -- "$NATIVE_ROOT/../washedup-web" && pwd)
VERIFY_OUTPUT=$(mktemp -d "${TMPDIR:-/tmp}/washedup-guinea-verify.XXXXXX")

case "$VERIFY_OUTPUT" in
  "${TMPDIR:-/tmp}"/washedup-guinea-verify.*) ;;
  *) echo "Refusing unexpected verification output path: $VERIFY_OUTPUT" >&2; exit 1 ;;
esac

cd "$NATIVE_ROOT"
npm run qa:all
npm run test:db:private
EXPO_NO_TELEMETRY=1 ./node_modules/.bin/expo export --platform web --output-dir "$VERIFY_OUTPUT/web"
EXPO_NO_TELEMETRY=1 ./node_modules/.bin/expo export --platform ios --output-dir "$VERIFY_OUTPUT/ios"
git diff --check

cd "$WEB_ROOT"
npm run typecheck
./node_modules/.bin/vitest run --no-cache
git diff --check

echo "Bundle artifacts retained at $VERIFY_OUTPUT"
echo "PASS: WashedUp native, private database, and web assertions"
