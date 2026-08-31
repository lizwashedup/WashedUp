import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const routing = read('lib/authRouting.ts');
const gate = read('lib/authGate.ts');
const migrationGate = read('app/(auth)/migration-gate.tsx');
const verifyCode = read('app/(auth)/verify-code.tsx');
const repair = read('supabase/migrations/20260831190000_fix_pgcrypto_search_path_for_signup.sql');
const canary = read('scripts/db-contracts/production-phone-signup-canary.sql');

assert.match(routing, /needs_phone_migration\s*===\s*true/, 'migration routing must require definite server true');
assert.match(gate, /res\?\.data\s*===\s*true/, 'migration RPC uncertainty must fail closed');
assert.match(migrationGate, /supabase\.auth\.updateUser\(\{\s*phone:\s*e164/s, 'legacy migration must use phone update');
assert.match(verifyCode, /mode\s*===\s*'migration'\s*\?\s*'phone_change'\s*:\s*'sms'/, 'migration OTP must verify as phone_change');
assert.match(verifyCode, /actualDigits\s*!==\s*expectedDigits/, 'migration must assert the phone was committed');

const expectedFunctions = [
  'enqueue_audience_sync_for_email',
  'profile_consent_metadata_guard',
  'profile_consent_evidence_enqueue',
  'quarantine_audience_webhook',
  'reconcile_quarantined_audience_events',
  'record_audience_provider_event',
  'record_audience_suppression',
  'record_profile_consent_evidence',
];
for (const functionName of expectedFunctions) {
  assert.match(repair, new RegExp(`ALTER FUNCTION public\\.${functionName}\\(`), `${functionName} must be repaired`);
}
assert.equal((repair.match(/SET search_path TO public, extensions;/g) ?? []).length, 8, 'all eight affected functions must include extensions');
assert.match(canary, /^BEGIN;/m, 'production canary must be transactional');
assert.match(canary, /^ROLLBACK;/m, 'production canary must always roll back');
assert.match(canary, /INSERT INTO auth\.users/i, 'production canary must exercise a new auth user insert');

console.log('PASS: auth routing, legacy migration, OTP verification, DB repair, and rollback canary invariants hold');
