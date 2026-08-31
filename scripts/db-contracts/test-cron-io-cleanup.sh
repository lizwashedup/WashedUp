#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
CONTAINER="washedup-cron-io-contract-$$"
CONTAINER_ID=
IMAGE="postgres:17-alpine"
MIGRATION="$REPO_ROOT/supabase/migrations/20260831160000_reduce_background_job_io.sql"
FIXTURE="$REPO_ROOT/supabase/tests/contracts/150_cron_io_cleanup_fixture.sql"
CONTRACT="$REPO_ROOT/supabase/tests/contracts/151_cron_io_cleanup_contract.sql"

case "$CONTAINER" in
  washedup-cron-io-contract-[0-9]*) ;;
  *) echo "unsafe container name: $CONTAINER" >&2; exit 2 ;;
esac

for required_file in "$MIGRATION" "$FIXTURE" "$CONTRACT"; do
  if [ ! -f "$required_file" ]; then
    echo "required cron IO contract file is missing: $required_file" >&2
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

docker image inspect "$IMAGE" >/dev/null
CONTAINER_ID=$(docker run \
  --detach \
  --rm \
  --pull never \
  --network none \
  --name "$CONTAINER" \
  --env POSTGRES_PASSWORD=contract-only \
  --volume "$MIGRATION:/migration.sql:ro" \
  --volume "$FIXTURE:/fixture.sql:ro" \
  --volume "$CONTRACT:/contract.sql:ro" \
  "$IMAGE")

invalid_id=$(printf '%s' "$CONTAINER_ID" | tr -d '0-9a-f')
if [ "${#CONTAINER_ID}" -ne 64 ] || [ -n "$invalid_id" ]; then
  echo "docker returned an invalid container id" >&2
  CONTAINER_ID=
  exit 2
fi

attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker exec "$CONTAINER_ID" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$attempt" -eq 30 ]; then
  echo "PostgreSQL did not become ready" >&2
  exit 2
fi

psql_file() {
  docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$1"
}

psql_file /fixture.sql
psql_file /migration.sql
psql_file /migration.sql
psql_file /contract.sql

echo "PASS: isolated cron IO cleanup contract"
