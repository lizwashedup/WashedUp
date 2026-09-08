#!/usr/bin/env bash
# Publish an iOS-only compatibility OTA for the public App Store 1.0.5 binary.
# The normal production publisher remains unchanged for current main releases.

set -euo pipefail

cd "$(dirname "$0")/.."

message="${1:-}"
if [ -z "$message" ]; then
  echo "Usage: $0 \"<message>\"" >&2
  exit 2
fi

export WASHEDUP_OTA_EXPECTED_BRANCH="codex/runtime105-livefix"
bash scripts/publish-ota.sh ios "$message"
