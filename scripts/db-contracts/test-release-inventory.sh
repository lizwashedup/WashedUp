#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTPUT=$(node "$SCRIPT_DIR/static-contracts.mjs")
printf '%s\n' "$OUTPUT"
printf '%s\n' "$OUTPUT" | grep -F 'RELEASE_CANDIDATES: 242 active migration(s), held excluded' >/dev/null
printf '%s\n' "$OUTPUT" | grep -F 'docs/database/review-only/community-join-policy-existing-text.sql' >/dev/null

# Ordinary active-migration safety prose such as "DO NOT APPLY WITHOUT"
# must never become a hold signal. The full active inventory remains counted.
if printf '%s\n' "$OUTPUT" | grep -F 'HELD: 202608' >/dev/null; then
  echo 'FAIL: generic active-migration safety comments were treated as holds' >&2
  exit 1
fi
echo 'PASS: generic safety comments do not shrink the active release inventory'

# Even a count/digest-approved tree must reject a newly appearing migration
# unless it has an explicit classification in the contracts manifest.
UNKNOWN_FIXTURE=20990101000000_unknown_fixture.sql
if NEGATIVE_OUTPUT=$(DB_CONTRACTS_UNTRACKED_OVERRIDE="$UNKNOWN_FIXTURE" node "$SCRIPT_DIR/static-contracts.mjs" 2>&1); then
  echo 'FAIL: unknown migration fixture passed the static gate' >&2
  exit 1
fi
printf '%s\n' "$NEGATIVE_OUTPUT" | grep -F "unknown active migration file(s): $UNKNOWN_FIXTURE" >/dev/null
printf '%s\n' "$NEGATIVE_OUTPUT" | grep -F 'Remediation: classify each file as active, held, or archive it' >/dev/null
echo 'PASS: an unknown migration fails with the exact file and remediation'
