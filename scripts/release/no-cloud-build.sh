#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

scan_targets=(package.json .github scripts)
pattern='(^|[^[:alnum:]_:])(npx[[:space:]]+)?eas(-cli)?[[:space:]]+(build|submit)([[:space:]]|$)'

set +e
raw_matches="$(grep -RInE \
  --exclude='no-cloud-build.sh' \
  --exclude-dir='node_modules' \
  --exclude-dir='.git' \
  "$pattern" "${scan_targets[@]}")"
scan_status=$?
set -e

if [[ $scan_status -gt 1 ]]; then
  echo "FAIL: unable to scan active release tooling for cloud build commands" >&2
  exit 1
fi

matches="$(printf '%s\n' "$raw_matches" | awk -F: '$3 !~ /^[[:space:]]*#/ { print }')"

if [[ -n "$matches" ]]; then
  echo "FAIL: cloud EAS build or submit command found in active release tooling" >&2
  echo "$matches" >&2
  exit 1
fi

echo "PASS: active release tooling contains no EAS cloud build or submit command"
