#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FIXTURE="$SCRIPT_DIR/drift-classifier.fixture.json"
OUTPUT=$(node "$SCRIPT_DIR/drift-classifier.mjs" --fixture "$FIXTURE")

printf '%s\n' "$OUTPUT" | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const result = JSON.parse(input);
  const expected = { tracked: 1, remote_only: 1, local_only: 1, held: 1, unknown: 2 };
  for (const [key, count] of Object.entries(expected)) {
    if (result.counts[key] !== count) throw new Error(`${key}: expected ${count}, found ${result.counts[key]}`);
  }
  if (result.production_contacted !== false || result.read_only !== true) throw new Error("fixture run was not read-only");
  if (result.held[0] !== "20260803000000_held.sql") throw new Error("held migration was not isolated");
  console.log("PASS: drift classifier separates tracked, remote-only, local-only, held, and unknown");
});
'
