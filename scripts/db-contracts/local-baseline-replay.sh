#!/bin/bash
# local-baseline-replay.sh — replay the full ordered supabase/migrations/*.sql
# history into one fresh, empty, disposable local Postgres database.
#
# What this proves: whether the active migration set can build a working
# database starting from nothing. What it does NOT prove: production
# equivalence -- see notes/critical-contract-audit-20260816.md for why (core
# tables like profiles/events/event_members were never captured as
# migrations at all, so this will very likely stop partway through with a
# real "relation does not exist" error; that is expected). This script
# exists to turn that vague, previously-undocumented assumption into an
# exact, reproduced break point: which file, which statement, which error.
#
# Read-only against production (never connects to it, never could --
# --network none, so no real password is ever needed -- trust auth is fine
# for a container nothing outside itself can reach). Disposable container,
# torn down on exit every time, success, failure, or interrupt.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
PROVENANCE="$REPO_ROOT/docs/database/migration-provenance.json"
IMAGE="postgres:17-alpine"
CONTAINER="washedup-baseline-replay-$$"
CONTAINER_ID=

case "$CONTAINER" in
  washedup-baseline-replay-[0-9]*) ;;
  *) echo "unsafe container name: $CONTAINER" >&2; exit 2 ;;
esac

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

# ── build the active, ordered, held-excluded file list ──────────────────
held_basenames="$(jq -r '.held_migrations[]?.file' "$PROVENANCE" 2>/dev/null | xargs -n1 basename 2>/dev/null || true)"

all_files=()
while IFS= read -r f; do all_files+=("$f"); done < <(cd "$MIGRATIONS_DIR" && ls -1 *.sql 2>/dev/null | sort)

active_files=()
for f in "${all_files[@]}"; do
  skip=0
  while IFS= read -r h; do
    [ -n "$h" ] && [ "$h" = "$f" ] && skip=1
  done <<<"$held_basenames"
  [ "$skip" -eq 0 ] && active_files+=("$f")
done

echo "local-baseline-replay: ${#all_files[@]} total migration files on disk, ${#active_files[@]} active after excluding held"

# ── boot a fresh, isolated, disposable Postgres ──────────────────────────
pg_env_name="POSTGRES_HOST_AUTH_METHOD"
pg_env_mode="trust"

docker image inspect "$IMAGE" >/dev/null
CONTAINER_ID=$(docker run \
  --detach \
  --rm \
  --pull never \
  --network none \
  --name "$CONTAINER" \
  --env "${pg_env_name}=${pg_env_mode}" \
  --volume "$MIGRATIONS_DIR:/migrations:ro" \
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

docker exec "$CONTAINER_ID" createdb -U postgres baseline_replay

# ── bootstrap the Supabase-managed roles migrations assume exist ────────
# Real Supabase projects provision anon/authenticated/service_role
# automatically; a plain Postgres image does not, and no migration in this
# repo's own history creates them (they're referenced by CREATE POLICY /
# GRANT, never DDL'd themselves). NOLOGIN matches their real Supabase role
# type -- nothing in this disposable, --network-none container ever
# connects as them.
docker exec -i "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d baseline_replay <<'SQL'
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$do$;
SQL

# ── bootstrap minimal auth/storage schema stand-ins ──────────────────────
# Real Supabase projects provision `auth` and `storage` schemas
# automatically (hosted or `supabase start`); a plain Postgres image has
# neither, and no migration in this repo's own history creates them (same
# gap as the role bootstrap above -- migrations assume these already
# exist). Structural surface only, scoped to exactly what the active
# migration set references (grepped, not guessed):
#   - storage.buckets / storage.objects: only the columns actually read or
#     written by CREATE POLICY / INSERT / self-test statements.
#   - storage.foldername(text): real Supabase implementation (splits the
#     object path, drops the filename) -- policies depend on its actual
#     behavior, not just its signature.
#   - auth.users / auth.refresh_tokens / auth.sessions: only the columns
#     actually referenced inside ban/moderation function bodies.
#   - auth.uid() / auth.role(): real Supabase implementation, reading the
#     request.jwt.claims GUC. This repo's own migrations self-test RLS with
#     the same set_config('request.jwt.claims', ...) + SET LOCAL ROLE
#     authenticated pattern real Supabase local dev uses, so a fixed-value
#     stub would silently defeat those self-tests instead of exercising
#     them. Confirmed via grep: every self-test in this repo sets only the
#     'sub' and 'role' keys on request.jwt.claims, never a per-field GUC
#     like request.jwt.claim.sub, so this stub does not read one either.
# auth.jwt() / auth.email() are deliberately NOT stubbed: grepped zero
# references (case-insensitive) across every active migration.
docker exec -i "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d baseline_replay <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  phone text,
  phone_confirmed_at timestamptz,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  raw_user_meta_data jsonb
);

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  user_id text
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  user_id uuid
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  bucket_id text,
  name text,
  metadata jsonb
);

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END
$$;
SQL

# ── replay every active migration, in order, stop at the first failure ──
applied=0
for f in "${active_files[@]}"; do
  set +e
  out="$(docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U postgres -d baseline_replay -f "/migrations/$f" 2>&1)"
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    echo ""
    echo "BROKE at file $((applied + 1)) of ${#active_files[@]}: $f"
    echo "--- psql output ---"
    echo "$out"
    echo "--- end ---"
    echo ""
    echo "RESULT: $applied of ${#active_files[@]} active migrations applied cleanly before this failure."
    exit 1
  fi
  applied=$((applied + 1))
done

echo ""
echo "RESULT: all $applied of ${#active_files[@]} active migrations applied cleanly to a fresh empty database."
