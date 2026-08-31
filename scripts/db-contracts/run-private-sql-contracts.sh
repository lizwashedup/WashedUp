#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEFAULT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
REPO_ROOT=$DEFAULT_ROOT
CONTRACT_ROOT=$REPO_ROOT
CONTAINER="washedup-db-contracts-$$"
CONTAINER_ID=
IMAGE="postgres:17-alpine"
DELETION_MIGRATION="$REPO_ROOT/supabase/migrations/20260815120000_user_deletion_fk_gap.sql"
REFUND_MIGRATION="$REPO_ROOT/supabase/migrations/20260814000000_refund_claim_and_reconcile_v3.sql"
VAULT_MIGRATION="$REPO_ROOT/supabase/migrations/20260815120100_notify_tokens_to_vault.sql"
PAYOUT_CLAIM_MIGRATION="$REPO_ROOT/supabase/migrations/20260816120000_claim_ticket_payout_batch_atomic.sql"
DEFAULT_PRIVILEGES_MIGRATION="$REPO_ROOT/supabase/migrations/20260816121000_revoke_unsafe_default_function_execute.sql"
PEOPLE_DM_MIGRATION="$REPO_ROOT/supabase/migrations/20260816122000_require_accepted_relationship_for_dm.sql"
CIRCLE_TRUST_MIGRATION="$REPO_ROOT/supabase/migrations/20260816123000_circle_member_vouching.sql"
CHAT_SCALE_MIGRATION="$REPO_ROOT/supabase/migrations/20260816130000_r42_chat_scale_review_only.sql"
PAYOUT_BLOCK_MIGRATION="$REPO_ROOT/supabase/migrations/20260817120000_block_delete_account_with_pending_payout.sql"
CIRCLE_SUGGESTIONS_MIGRATION="$REPO_ROOT/docs/database/review-only/circle-suggestions-v2.sql"
COMMUNITY_JOIN_POLICY_MIGRATION="$REPO_ROOT/docs/database/review-only/community-join-policy-existing-text.sql"
TECHNICAL_HARDENING_MIGRATION="$REPO_ROOT/docs/database/review-only/technical-database-hardening.sql"
EVENT_MEMBERS_PUBLIC_MIGRATION="$REPO_ROOT/supabase/migrations/20260824210000_secure_event_members_public_visibility.sql"
TOPIC_ALBUM_HARDENING_MIGRATION="$REPO_ROOT/supabase/migrations/20260824211000_harden_topic_album_upload_metadata.sql"
IDENTITY_MARKS_TRIGGER_MIGRATION="$REPO_ROOT/supabase/migrations/20260824212000_fix_event_members_identity_marks_trigger_safe.sql"
THRESHOLD_CHAT_MIGRATION="$REPO_ROOT/supabase/migrations/20260828200000_community_topic_chat_parity_phase1.sql"
THRESHOLD_RECEIPT_MIGRATION="$REPO_ROOT/supabase/migrations/20260829210000_ticket_receipt_resend_rate_limit.sql"
DELIVERABILITY_MIGRATION="$REPO_ROOT/supabase/migrations/20260830120000_free_rsvp_confirmation_outbox.sql"
CONSENT_SYNC_MIGRATION="$REPO_ROOT/supabase/migrations/20260830130000_audience_sync_outbox_and_suppression.sql"
CONSENT_SYNC_ACL_MIGRATION="$REPO_ROOT/supabase/migrations/20260831180000_revoke_service_role_low_level_suppression.sql"
CONSENT_SYNC_PGCRYPTO_REPAIR_MIGRATION="$REPO_ROOT/supabase/migrations/20260831190000_fix_pgcrypto_search_path_for_signup.sql"
DELIVERY_SCHEDULER_MIGRATION="$REPO_ROOT/supabase/migrations/20260831170000_schedule_delivery_workers_seed_only.sql"
DELIVERY_RESCUE_SQL="$REPO_ROOT/scripts/deliverability/g0-rescue.sql"
CONTRACT_FILES="$CONTRACT_ROOT/supabase/tests/contracts"
CONTRACT_LANE=${DB_CONTRACT_LANE:-${1:-}}

case "$CONTAINER" in
  washedup-db-contracts-[0-9]*) ;;
  *) echo "unsafe container name: $CONTAINER" >&2; exit 2 ;;
esac

for required_file in \
  "$DELETION_MIGRATION" \
  "$REFUND_MIGRATION" \
  "$VAULT_MIGRATION" \
  "$PAYOUT_CLAIM_MIGRATION" \
  "$DEFAULT_PRIVILEGES_MIGRATION" \
  "$PEOPLE_DM_MIGRATION" \
  "$CIRCLE_TRUST_MIGRATION" \
  "$CHAT_SCALE_MIGRATION" \
  "$PAYOUT_BLOCK_MIGRATION" \
  "$CIRCLE_SUGGESTIONS_MIGRATION" \
  "$COMMUNITY_JOIN_POLICY_MIGRATION" \
  "$TECHNICAL_HARDENING_MIGRATION" \
  "$EVENT_MEMBERS_PUBLIC_MIGRATION" \
  "$TOPIC_ALBUM_HARDENING_MIGRATION" \
  "$IDENTITY_MARKS_TRIGGER_MIGRATION" \
  "$THRESHOLD_CHAT_MIGRATION" \
  "$THRESHOLD_RECEIPT_MIGRATION" \
  "$DELIVERABILITY_MIGRATION" \
  "$CONSENT_SYNC_MIGRATION" \
  "$CONSENT_SYNC_ACL_MIGRATION" \
  "$CONSENT_SYNC_PGCRYPTO_REPAIR_MIGRATION" \
  "$DELIVERY_SCHEDULER_MIGRATION" \
  "$DELIVERY_RESCUE_SQL" \
  "$CONTRACT_FILES/00_account_deletion_fixture.sql" \
  "$CONTRACT_FILES/01_account_deletion_contract.sql" \
  "$CONTRACT_FILES/10_refund_fixture.sql" \
  "$CONTRACT_FILES/11_refund_two_session_contract.sql" \
  "$CONTRACT_FILES/20_vault_fixture.sql" \
  "$CONTRACT_FILES/21_vault_contract.sql" \
  "$CONTRACT_FILES/30_default_privileges_fixture.sql" \
  "$CONTRACT_FILES/31_default_privileges_contract.sql" \
  "$CONTRACT_FILES/40_payout_claim_fixture.sql" \
  "$CONTRACT_FILES/41_payout_claim_contract.sql" \
  "$CONTRACT_FILES/50_people_dm_fixture.sql" \
  "$CONTRACT_FILES/51_people_dm_contract.sql" \
  "$CONTRACT_FILES/52_circle_trust_fixture.sql" \
  "$CONTRACT_FILES/53_circle_trust_contract.sql" \
  "$CONTRACT_FILES/60_chat_scale_fixture.sql" \
  "$CONTRACT_FILES/61_chat_scale_contract.sql" \
  "$CONTRACT_FILES/70_payout_block_fixture.sql" \
  "$CONTRACT_FILES/71_payout_block_contract.sql" \
  "$CONTRACT_FILES/80_circle_suggestions_fixture.sql" \
  "$CONTRACT_FILES/81_circle_suggestions_contract.sql" \
  "$CONTRACT_FILES/90_community_join_policy_fixture.sql" \
  "$CONTRACT_FILES/91_community_join_policy_contract.sql" \
  "$CONTRACT_FILES/100_technical_database_hardening_fixture.sql" \
  "$CONTRACT_FILES/101_technical_database_hardening_contract.sql" \
  "$CONTRACT_FILES/110_release_blockers_fixture.sql" \
  "$CONTRACT_FILES/111_release_blockers_contract.sql" \
  "$CONTRACT_FILES/120_threshold_75_fixture.sql" \
  "$CONTRACT_FILES/121_threshold_75_contract.sql" \
  "$CONTRACT_FILES/130_deliverability_fixture.sql" \
  "$CONTRACT_FILES/131_deliverability_contract.sql" \
  "$CONTRACT_FILES/140_consent_sync_fixture.sql" \
  "$CONTRACT_FILES/141_consent_sync_contract.sql" \
  "$CONTRACT_FILES/160_delivery_scheduler_fixture.sql" \
  "$CONTRACT_FILES/161_delivery_scheduler_contract.sql" \
  "$CONTRACT_FILES/162_delivery_rescue_contract.sql"
do
  if [ ! -f "$required_file" ]; then
    echo "required private contract file is missing: $required_file" >&2
    exit 2
  fi
done

cleanup() {
  if [ -z "$CONTAINER_ID" ]; then return; fi
  invalid_id=$(printf '%s' "$CONTAINER_ID" | tr -d '0-9a-f')
  if [ "${#CONTAINER_ID}" -ne 64 ] || [ -n "$invalid_id" ]; then
    echo "refusing cleanup for invalid container id" >&2
    return
  fi
  actual_id=$(docker inspect --format '{{.Id}}' "$CONTAINER_ID" 2>/dev/null || true)
  if [ "$actual_id" = "$CONTAINER_ID" ]; then
    docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

static_status=0
if [ "$CONTRACT_LANE" != "threshold-75" ]; then
  node "$REPO_ROOT/scripts/db-contracts/static-contracts.mjs" || static_status=$?
fi

docker image inspect "$IMAGE" >/dev/null
CONTAINER_ID=$(docker run \
  --detach \
  --rm \
  --pull never \
  --network none \
  --name "$CONTAINER" \
  --env POSTGRES_PASSWORD=contract-only \
  --volume "$DELETION_MIGRATION:/migrations/deletion.sql:ro" \
  --volume "$REFUND_MIGRATION:/migrations/refund.sql:ro" \
  --volume "$VAULT_MIGRATION:/migrations/vault.sql:ro" \
  --volume "$PAYOUT_CLAIM_MIGRATION:/migrations/payout-claim.sql:ro" \
  --volume "$DEFAULT_PRIVILEGES_MIGRATION:/migrations/default-privileges.sql:ro" \
  --volume "$PEOPLE_DM_MIGRATION:/migrations/people-dm.sql:ro" \
  --volume "$CIRCLE_TRUST_MIGRATION:/migrations/circle-trust.sql:ro" \
  --volume "$CHAT_SCALE_MIGRATION:/migrations/chat-scale.sql:ro" \
  --volume "$PAYOUT_BLOCK_MIGRATION:/migrations/payout-block.sql:ro" \
  --volume "$CIRCLE_SUGGESTIONS_MIGRATION:/migrations/circle-suggestions.sql:ro" \
  --volume "$COMMUNITY_JOIN_POLICY_MIGRATION:/migrations/community-join-policy.sql:ro" \
  --volume "$TECHNICAL_HARDENING_MIGRATION:/migrations/technical-database-hardening.sql:ro" \
  --volume "$EVENT_MEMBERS_PUBLIC_MIGRATION:/migrations/event-members-public.sql:ro" \
  --volume "$TOPIC_ALBUM_HARDENING_MIGRATION:/migrations/topic-album-hardening.sql:ro" \
  --volume "$IDENTITY_MARKS_TRIGGER_MIGRATION:/migrations/identity-marks-trigger.sql:ro" \
  --volume "$THRESHOLD_CHAT_MIGRATION:/migrations/threshold-chat.sql:ro" \
  --volume "$THRESHOLD_RECEIPT_MIGRATION:/migrations/threshold-receipt.sql:ro" \
  --volume "$DELIVERABILITY_MIGRATION:/migrations/deliverability.sql:ro" \
  --volume "$CONSENT_SYNC_MIGRATION:/migrations/consent-sync.sql:ro" \
  --volume "$CONSENT_SYNC_ACL_MIGRATION:/migrations/consent-sync-acl.sql:ro" \
  --volume "$CONSENT_SYNC_PGCRYPTO_REPAIR_MIGRATION:/migrations/consent-sync-pgcrypto-repair.sql:ro" \
  --volume "$DELIVERY_SCHEDULER_MIGRATION:/migrations/delivery-scheduler.sql:ro" \
  --volume "$DELIVERY_RESCUE_SQL:/g0-rescue.sql:ro" \
  --volume "$CONTRACT_FILES:/contracts:ro" \
  "$IMAGE")
invalid_id=$(printf '%s' "$CONTAINER_ID" | tr -d '0-9a-f')
if [ "${#CONTAINER_ID}" -ne 64 ] || [ -n "$invalid_id" ]; then
  echo "docker returned an invalid container id" >&2
  CONTAINER_ID=
  exit 2
fi

ready=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker exec "$CONTAINER_ID" pg_isready -U postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "PostgreSQL did not become ready" >&2
  exit 2
fi

psql_file() {
  database=$1
  file=$2
  docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" -f "$file"
}

create_contract_db() {
  database=$1
  case "$database" in
    *[!a-z0-9_]*) echo "unsafe contract database name: $database" >&2; exit 2 ;;
  esac
  attempt=0
  while [ "$attempt" -lt 15 ]; do
    if docker exec "$CONTAINER_ID" createdb -U postgres "$database"; then
      return
    fi
    existing=$(docker exec "$CONTAINER_ID" psql -U postgres -d postgres -Atqc \
      "SELECT 1 FROM pg_database WHERE datname = '$database'" 2>/dev/null || true)
    if [ "$existing" = "1" ]; then
      return
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "PostgreSQL never became stable enough to create $database" >&2
  docker logs --tail 50 "$CONTAINER_ID" >&2 || true
  exit 2
}

run_release_blockers_contract() {
  create_contract_db release_blockers_contract
  psql_file release_blockers_contract /contracts/110_release_blockers_fixture.sql
  psql_file release_blockers_contract /migrations/event-members-public.sql
  psql_file release_blockers_contract /migrations/topic-album-hardening.sql
  psql_file release_blockers_contract /migrations/identity-marks-trigger.sql
  psql_file release_blockers_contract /contracts/111_release_blockers_contract.sql
}

run_threshold_75_contract() {
  create_contract_db threshold_75_contract
  psql_file threshold_75_contract /contracts/120_threshold_75_fixture.sql
  psql_file threshold_75_contract /migrations/threshold-chat.sql
  psql_file threshold_75_contract /migrations/threshold-receipt.sql
  psql_file threshold_75_contract /contracts/121_threshold_75_contract.sql
}

run_deliverability_contract() {
  create_contract_db deliverability_contract
  psql_file deliverability_contract /contracts/130_deliverability_fixture.sql
  psql_file deliverability_contract /migrations/deliverability.sql
  psql_file deliverability_contract /contracts/131_deliverability_contract.sql
}

run_consent_sync_contract() {
  create_contract_db consent_sync_contract
  psql_file consent_sync_contract /contracts/140_consent_sync_fixture.sql
  psql_file consent_sync_contract /migrations/deliverability.sql
  psql_file consent_sync_contract /migrations/consent-sync.sql
  docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d consent_sync_contract -c \
    "GRANT EXECUTE ON FUNCTION public.record_audience_suppression(text, text, text) TO service_role;"
  psql_file consent_sync_contract /migrations/consent-sync-acl.sql
  psql_file consent_sync_contract /migrations/consent-sync-acl.sql
  psql_file consent_sync_contract /migrations/consent-sync-pgcrypto-repair.sql
  psql_file consent_sync_contract /migrations/consent-sync-pgcrypto-repair.sql
  psql_file consent_sync_contract /contracts/141_consent_sync_contract.sql
}

run_delivery_scheduler_contract() {
  create_contract_db delivery_scheduler_contract
  psql_file delivery_scheduler_contract /contracts/160_delivery_scheduler_fixture.sql
  set +e
  scheduler_missing_output=$(docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d delivery_scheduler_contract \
    -f /migrations/delivery-scheduler.sql 2>&1)
  scheduler_missing_status=$?
  set -e
  if [ "$scheduler_missing_status" -eq 0 ]; then
    echo "delivery scheduler accepted missing Vault tokens" >&2
    exit 1
  fi
  echo "$scheduler_missing_output" | grep -F "Vault token(s) are missing or empty" >/dev/null
  docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d delivery_scheduler_contract -c \
    "INSERT INTO vault.decrypted_secrets(name, decrypted_secret) VALUES ('transactional_email_run_token','fixture-transactional-token'), ('audience_sync_run_token','fixture-audience-token');"
  psql_file delivery_scheduler_contract /migrations/delivery-scheduler.sql
  psql_file delivery_scheduler_contract /contracts/161_delivery_scheduler_contract.sql
  psql_file delivery_scheduler_contract /g0-rescue.sql
  psql_file delivery_scheduler_contract /contracts/162_delivery_rescue_contract.sql
}

if [ "$CONTRACT_LANE" = "release-blockers" ]; then
  run_release_blockers_contract
  echo "PASS: focused release-blocker database contracts"
  exit 0
fi

if [ "$CONTRACT_LANE" = "threshold-75" ]; then
  run_threshold_75_contract
  echo "PASS: focused threshold 75 database contracts"
  exit 0
fi

if [ "$CONTRACT_LANE" = "deliverability" ]; then
  run_deliverability_contract
  echo "PASS: focused deliverability database contracts"
  exit 0
fi

if [ "$CONTRACT_LANE" = "consent-sync" ]; then
  run_consent_sync_contract
  echo "PASS: focused consent-sync database contracts"
  exit 0
fi

if [ "$CONTRACT_LANE" = "delivery-scheduler" ]; then
  run_delivery_scheduler_contract
  echo "PASS: focused G0 delivery scheduler and rescue contracts"
  exit 0
fi

create_contract_db deletion_contract
psql_file deletion_contract /contracts/00_account_deletion_fixture.sql
psql_file deletion_contract /migrations/deletion.sql
psql_file deletion_contract /contracts/01_account_deletion_contract.sql

create_contract_db refund_contract
psql_file refund_contract /contracts/10_refund_fixture.sql
awk '/fix 3: reconcile v3/{exit} {print}' \
  "$REFUND_MIGRATION" \
  | docker exec -i "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d refund_contract
psql_file refund_contract /contracts/11_refund_two_session_contract.sql

create_contract_db vault_contract
psql_file vault_contract /contracts/20_vault_fixture.sql
set +e
vault_missing_output=$(docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d vault_contract \
  -f /migrations/vault.sql 2>&1)
vault_missing_status=$?
set -e
if [ "$vault_missing_status" -eq 0 ]; then
  echo "Vault precondition contract failed: migration accepted missing secrets" >&2
  exit 1
fi
echo "$vault_missing_output" | grep -F "refusing to apply: vault secret(s)" >/dev/null
docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d vault_contract -c \
  "INSERT INTO vault.decrypted_secrets(name, decrypted_secret) VALUES ('notify_report_run_token','fixture-report-token'), ('notify_plan_posted_run_token','fixture-plan-token');"
psql_file vault_contract /migrations/vault.sql
psql_file vault_contract /contracts/21_vault_contract.sql

create_contract_db default_privileges_contract
psql_file default_privileges_contract /contracts/30_default_privileges_fixture.sql
psql_file default_privileges_contract /migrations/default-privileges.sql
psql_file default_privileges_contract /contracts/31_default_privileges_contract.sql

create_contract_db payout_contract
psql_file payout_contract /contracts/40_payout_claim_fixture.sql
psql_file payout_contract /migrations/payout-claim.sql
psql_file payout_contract /contracts/41_payout_claim_contract.sql

create_contract_db people_dm_contract
psql_file people_dm_contract /contracts/50_people_dm_fixture.sql
psql_file people_dm_contract /migrations/people-dm.sql
psql_file people_dm_contract /contracts/51_people_dm_contract.sql

create_contract_db circle_trust_contract
psql_file circle_trust_contract /contracts/52_circle_trust_fixture.sql
psql_file circle_trust_contract /migrations/circle-trust.sql
psql_file circle_trust_contract /contracts/53_circle_trust_contract.sql

create_contract_db chat_scale_contract
psql_file chat_scale_contract /contracts/60_chat_scale_fixture.sql
psql_file chat_scale_contract /migrations/chat-scale.sql
psql_file chat_scale_contract /contracts/61_chat_scale_contract.sql

create_contract_db payout_block_contract
psql_file payout_block_contract /contracts/70_payout_block_fixture.sql
psql_file payout_block_contract /migrations/payout-block.sql
psql_file payout_block_contract /contracts/71_payout_block_contract.sql

create_contract_db circle_suggestions_contract
psql_file circle_suggestions_contract /contracts/80_circle_suggestions_fixture.sql
psql_file circle_suggestions_contract /migrations/circle-suggestions.sql
psql_file circle_suggestions_contract /contracts/81_circle_suggestions_contract.sql

create_contract_db community_join_policy_contract
psql_file community_join_policy_contract /contracts/90_community_join_policy_fixture.sql
psql_file community_join_policy_contract /migrations/community-join-policy.sql
psql_file community_join_policy_contract /contracts/91_community_join_policy_contract.sql

create_contract_db technical_database_hardening_contract
psql_file technical_database_hardening_contract /contracts/100_technical_database_hardening_fixture.sql
psql_file technical_database_hardening_contract /migrations/technical-database-hardening.sql
psql_file technical_database_hardening_contract /contracts/101_technical_database_hardening_contract.sql

run_release_blockers_contract
run_threshold_75_contract
run_deliverability_contract
run_consent_sync_contract
run_delivery_scheduler_contract

echo "PASS: account deletion, refund locking, Vault headers, future function defaults, payout batch claims, accepted-relationship DMs, Circle trust edges, bounded chat paging, pending-payout deletion block, Circle suggestions, Community join-policy preparation, technical database hardening, event member visibility, topic album metadata, identity-marks trigger safety, durable free RSVP confirmations, audience consent sync, and G0 scheduler rescue"
if [ "$static_status" -ne 0 ]; then
  echo "Release gate remains closed by static diagnostics"
  exit "$static_status"
fi
echo "PASS: private database contract gate"
