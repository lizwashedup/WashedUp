import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const failures = [];
const requireText = (content, needle, label) => {
  if (!content.includes(needle)) failures.push(`${label}: missing ${needle}`);
};

const config = read('supabase/config.toml');
requireText(config, '[functions.add-to-resend-audience]\nverify_jwt = true', 'user endpoint config');
requireText(config, '[functions.audience-sync-drain]\nverify_jwt = false', 'run-token endpoint config');
requireText(config, '[functions.resend-suppression-webhook]\nverify_jwt = false', 'Svix endpoint config');
requireText(config, '[functions.transactional-email-drain]\nverify_jwt = false', 'transactional worker config');

const add = read('supabase/functions/add-to-resend-audience/index.ts');
requireText(add, 'enqueue_current_profile_audience_sync', 'authenticated enqueue handler');
requireText(add, 'audience sync unavailable', 'authenticated enqueue generic client error');

const drain = read('supabase/functions/audience-sync-drain/index.ts');
for (const rpc of [
  'acquire_delivery_worker_lease',
  'release_delivery_worker_lease',
  'reconcile_quarantined_audience_events',
  'claim_audience_contact_reconciliations',
  'complete_audience_contact_reconciliation',
  'claim_audience_sync_jobs',
  'complete_audience_sync_job',
]) requireText(drain, rpc, 'audience drain handler');
requireText(drain, 'x-run-token', 'audience drain handler');
if (/RESEND_AUDIENCE_ID[^\n]+\?\?\s*["'][0-9a-f-]{20,}/.test(drain)) {
  failures.push('audience drain handler: hardcoded audience fallback is forbidden');
}

const webhook = read('supabase/functions/resend-suppression-webhook/index.ts');
requireText(webhook, 'record_audience_provider_event', 'suppression webhook handler');
requireText(webhook, 'providerEventScope', 'suppression webhook scope handler');
requireText(webhook, 'verifySvixRequest', 'suppression webhook handler');
const rawRead = webhook.indexOf('await req.text()');
const parse = webhook.indexOf('JSON.parse(rawBody)');
if (rawRead < 0 || parse < 0 || rawRead > parse) {
  failures.push('suppression webhook handler: raw body must be read before parsing');
}

const transactional = read('supabase/functions/transactional-email-drain/index.ts');
requireText(transactional, 'acquire_delivery_worker_lease', 'transactional worker singleton guard');
requireText(transactional, 'release_delivery_worker_lease', 'transactional worker singleton guard');

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log('PASS: consent-sync endpoint wiring and gateway posture');
