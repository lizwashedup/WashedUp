#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-local}"
EXPECTED_TICKET_DRAIN_SHA="86592aed95f1f51412f93ca48cb4790455381a5aef95772e7a0bc85b363c2984"
EXPECTED_TICKET_RESEND_SHA="fafb70d0774e427f3fea7aa7ec2b6b513dd2ac7d81827eba56446fb55e67e349"
RELEASE_EVIDENCE="qa/evidence/75-threshold-release.json"
DEVICE_EVIDENCE="qa/evidence/75-threshold-device.json"

pass() {
  echo "PASS: $1"
}

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

verify_local() {
  cd "$ROOT_DIR"

  git merge-base --is-ancestor 9b58e05 HEAD || fail "community chat and event-ticket commit is not included"
  pass "community chat and event-ticket commit is included"

  git merge-base --is-ancestor b99e369 HEAD || fail "creator-loop fix is not included"
  pass "creator-loop fix is included"

  git merge-base --is-ancestor 822e0d4 HEAD || fail "build 34 commit is not included"
  pass "build 34 commit is included"

  npm run qa:all
  deno check --no-config supabase/functions/ticket-inbox-drain/index.ts supabase/functions/ticket-resend-receipt/index.ts
  npm run qa:75:db
  pass "full app QA, Edge Function compile, and executable threshold database contracts"
}

verify_live() {
  cd "$ROOT_DIR"
  verify_local

  [[ -f "$RELEASE_EVIDENCE" ]] || fail "release evidence is missing; record the finished tester build from the tracked example"

  local expected_build_id expected_build_commit expected_build_number expected_app_version
  local configured_build_number configured_app_version
  expected_build_id="$(node -p "JSON.parse(require('fs').readFileSync('$RELEASE_EVIDENCE','utf8')).eas_build_id")"
  expected_build_commit="$(node -p "JSON.parse(require('fs').readFileSync('$RELEASE_EVIDENCE','utf8')).reviewed_commit")"
  expected_build_number="$(node -p "JSON.parse(require('fs').readFileSync('$RELEASE_EVIDENCE','utf8')).build_number")"
  expected_app_version="$(node -p "JSON.parse(require('fs').readFileSync('$RELEASE_EVIDENCE','utf8')).app_version")"
  configured_build_number="$(node -p "JSON.parse(require('fs').readFileSync('app.json','utf8')).expo.ios.buildNumber")"
  configured_app_version="$(node -p "JSON.parse(require('fs').readFileSync('app.json','utf8')).expo.version")"

  [[ "$expected_build_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] || fail "release evidence has no valid EAS build ID"
  [[ "$expected_build_commit" =~ ^[0-9a-fA-F]{40}$ ]] || fail "release evidence has no full reviewed commit SHA"
  [[ "$expected_build_number" == "$configured_build_number" ]] || fail "release evidence build does not match app.json build $configured_build_number"
  [[ "$expected_app_version" == "$configured_app_version" ]] || fail "release evidence version does not match app.json version $configured_app_version"
  git merge-base --is-ancestor "$expected_build_commit" HEAD || fail "reviewed release commit is not in the current branch"

  local changed_after_build dirty_release_paths
  changed_after_build="$(git diff --name-only "$expected_build_commit"..HEAD | grep -Ev '^(qa/evidence/|scripts/verify-75-threshold\.sh$|scripts/validate-75-evidence\.mjs$)' || true)"
  [[ -z "$changed_after_build" ]] || fail "runtime files changed after the reviewed build commit: $changed_after_build"
  dirty_release_paths="$(git status --porcelain=v1 | sed -E 's/^...//' | grep -Ev '^qa/evidence/' || true)"
  [[ -z "$dirty_release_paths" ]] || fail "runtime working tree is dirty; the tester build would not represent current code: $dirty_release_paths"

  node scripts/validate-75-evidence.mjs "$DEVICE_EVIDENCE" "$RELEASE_EVIDENCE"

  local build_output
  build_output="$(eas build:view "$expected_build_id")"
  grep -q "Status[[:space:]]*finished" <<<"$build_output" || fail "EAS threshold build is not finished"
  grep -q "Build number[[:space:]]*$expected_build_number" <<<"$build_output" || fail "EAS artifact is not build $expected_build_number"
  grep -q "Commit[[:space:]]*$expected_build_commit" <<<"$build_output" || fail "EAS threshold build does not contain the reviewed release commit"
  pass "EAS build $expected_build_number is finished and contains the reviewed commit"

  local test_order_id
  test_order_id="$(node -p "JSON.parse(require('fs').readFileSync('$DEVICE_EVIDENCE','utf8')).test_order_id")"

  local sql
  sql="select (select count(*) from public.ticket_orders where id = '$test_order_id'::uuid and status = 'paid' and confirmation_email_sent_at is not null and confirmation_email_id is not null) as provider_confirmed_orders, exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'community_topic_message_reactions') as reactions_table_live, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'community_topic_messages' and column_name = 'reply_to_message_id') as topic_replies_live, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'community_topic_messages' and column_name = 'edited_at') as topic_edit_live, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ticket_orders' and column_name = 'receipt_resend_last_requested_at') as receipt_cooldown_live, exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid where t.tgname='community_topic_message_identity_guard' and n.nspname='public' and c.relname='community_topic_messages' and p.proname='community_topic_message_identity_immutable' and t.tgenabled='O' and not t.tgisinternal) as message_identity_guard_live, exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid where t.tgname='community_topic_message_reply_topic_guard' and n.nspname='public' and c.relname='community_topic_messages' and p.proname='community_topic_message_reply_same_topic' and t.tgenabled='O' and not t.tgisinternal) as reply_topic_guard_live, exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid where t.tgname='community_topic_reaction_identity_guard' and n.nspname='public' and c.relname='community_topic_message_reactions' and p.proname='community_topic_reaction_identity_immutable' and t.tgenabled='O' and not t.tgisinternal) as reaction_identity_guard_live, exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid where t.tgname='community_broadcast_identity_guard' and n.nspname='public' and c.relname='community_broadcasts' and p.proname='community_broadcast_identity_immutable' and t.tgenabled='O' and not t.tgisinternal) as broadcast_identity_guard_live, exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid where t.tgname='ticket_receipt_resend_cooldown_guard' and n.nspname='public' and c.relname='ticket_orders' and p.proname='ticket_receipt_resend_cooldown_service_only' and t.tgenabled='O' and not t.tgisinternal) as receipt_cooldown_guard_live;"

  local db_output
  db_output="$(npx supabase db query --linked "$sql")"
  THRESHOLD_DB_OUTPUT="$db_output" node <<'NODE'
const raw = process.env.THRESHOLD_DB_OUTPUT ?? '';
const start = raw.indexOf('{');
if (start < 0) throw new Error('Supabase query returned no JSON object');
const payload = JSON.parse(raw.slice(start));
const row = payload.rows?.[0];
if (!row) throw new Error('Supabase query returned no result row');
const checks = [
  ['one paid order has both a confirmation timestamp and provider ID', Number(row.provider_confirmed_orders) > 0],
  ['community topic reactions table is live', row.reactions_table_live === true],
  ['community topic reply column is live', row.topic_replies_live === true],
  ['community topic edit column is live', row.topic_edit_live === true],
  ['receipt resend cooldown is live', row.receipt_cooldown_live === true],
  ['topic message identity guard is live', row.message_identity_guard_live === true],
  ['topic reply same-room guard is live', row.reply_topic_guard_live === true],
  ['topic reaction identity guard is live', row.reaction_identity_guard_live === true],
  ['main-thread message identity guard is live', row.broadcast_identity_guard_live === true],
  ['receipt resend cooldown guard is live', row.receipt_cooldown_guard_live === true],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
if (failed.length) process.exit(1);
NODE

  local functions_output
  functions_output="$(npx supabase functions list --output json)"
  THRESHOLD_FUNCTIONS_OUTPUT="$functions_output" EXPECTED_TICKET_DRAIN_SHA="$EXPECTED_TICKET_DRAIN_SHA" EXPECTED_TICKET_RESEND_SHA="$EXPECTED_TICKET_RESEND_SHA" node <<'NODE'
const raw = process.env.THRESHOLD_FUNCTIONS_OUTPUT ?? '';
const start = raw.indexOf('[');
if (start < 0) throw new Error('Supabase function list returned no JSON array');
const rows = JSON.parse(raw.slice(start));
const drain = rows.find((row) => row.slug === 'ticket-inbox-drain');
const resend = rows.find((row) => row.slug === 'ticket-resend-receipt');
const checks = [
  ['ticket-inbox-drain exact reviewed bundle is deployed', drain?.status === 'ACTIVE' && drain.ezbr_sha256 === process.env.EXPECTED_TICKET_DRAIN_SHA],
  ['ticket-resend-receipt exact reviewed bundle is deployed', resend?.status === 'ACTIVE' && resend.ezbr_sha256 === process.env.EXPECTED_TICKET_RESEND_SHA],
];
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
NODE

  pass "production backend and dated real-device evidence satisfy the 75-organization gate"
}

case "$MODE" in
  local)
    verify_local
    ;;
  live)
    verify_live
    ;;
  *)
    fail "usage: $0 [local|live]"
    ;;
esac
