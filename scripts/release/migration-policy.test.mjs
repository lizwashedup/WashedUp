import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateMigrationChanges, parseNameStatus, scanMigrationSql } from './migration-policy.mjs';

test('accepts additive and security-hardening SQL', () => {
  assert.deepEqual(scanMigrationSql(`
    CREATE TABLE public.safe_addition (id uuid PRIMARY KEY);
    ALTER FUNCTION public.example() SET search_path = public, extensions;
    REVOKE EXECUTE ON FUNCTION public.example() FROM service_role;
  `), []);
});

test('rejects destructive migration statements', () => {
  const violations = scanMigrationSql(`
    DROP TABLE public.accounts;
    ALTER TABLE public.profiles DROP COLUMN phone_number;
    DELETE FROM public.profiles;
  `);
  assert.deepEqual(violations, ['DROP TABLE', 'DROP COLUMN', 'DELETE WITHOUT WHERE']);
});

test('rejects edits to an existing migration even if SQL is additive', () => {
  const root = mkdtempSync(join(tmpdir(), 'washedup-migration-policy-'));
  mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
  const path = 'supabase/migrations/20260831000000_existing.sql';
  writeFileSync(join(root, path), 'CREATE TABLE public.safe_addition (id uuid);');
  assert.deepEqual(
    evaluateMigrationChanges([{ status: 'M', path }], root),
    [`${path}: existing migration history is immutable (M)`],
  );
});

test('parses rename records using the destination path', () => {
  assert.deepEqual(parseNameStatus('R100\tsupabase/migrations/old.sql\tsupabase/migrations/new.sql\n'), [
    { status: 'R100', path: 'supabase/migrations/new.sql' },
  ]);
});
