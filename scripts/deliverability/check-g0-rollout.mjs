import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const manifest = JSON.parse(
  read("scripts/deliverability/g0-release-manifest.json"),
);
const failures = [];
const requireText = (text, needle, label) => {
  if (!text.includes(needle)) failures.push(`${label}: missing ${needle}`);
};

for (const [path, expected] of Object.entries(manifest.files)) {
  const actual = createHash("sha256").update(readFileSync(resolve(root, path)))
    .digest("hex");
  if (actual !== expected) {
    failures.push(`${path}: hash drifted from the frozen G0 manifest`);
  }
}

const delivery = read(
  "supabase/migrations/20260830120000_free_rsvp_confirmation_outbox.sql",
);
const consent = read(
  "supabase/migrations/20260830130000_audience_sync_outbox_and_suppression.sql",
);
const scheduler = read(
  "supabase/migrations/20260831170000_schedule_delivery_workers_seed_only.sql",
);
const rescue = read("scripts/deliverability/g0-rescue.sql");
const config = read("supabase/config.toml");
const audienceWorker = read("supabase/functions/audience-sync-drain/index.ts");
const transactionalWorker = read(
  "supabase/functions/transactional-email-drain/index.ts",
);

requireText(delivery, "DEFAULT 'quarantined'", "delivery activation interlock");
requireText(
  delivery,
  "IN ('quarantined', 'seed_only', 'live')",
  "delivery activation interlock",
);
requireText(delivery, "delivery_seed_profiles", "seed-only claim scope");
requireText(
  delivery,
  "acquire_delivery_worker_lease",
  "database singleton guard",
);
requireText(
  consent,
  "profile_consent_metadata_guard_trigger",
  "signup-safe BEFORE trigger",
);
requireText(
  consent,
  "profile_consent_evidence_enqueue_trigger",
  "signup-safe AFTER trigger",
);
requireText(
  consent,
  "audience_webhook_quarantine",
  "provider event quarantine",
);
requireText(
  consent,
  "reconcile_quarantined_audience_events",
  "delayed send-receipt reconciliation",
);
requireText(
  consent,
  "audience_contact_reconciliation",
  "reversible provider preference",
);
requireText(consent, "interval '30 days'", "raw email terminal retention");
requireText(consent, "interval '2 years'", "hash evidence retention");
if (
  /cron\.schedule\s*\(/i.test(delivery) || /cron\.schedule\s*\(/i.test(consent)
) {
  failures.push(
    "schema migrations must not activate recurring delivery schedules",
  );
}
requireText(
  scheduler,
  "IS DISTINCT FROM 'seed_only'",
  "scheduler seed-only preflight",
);
requireText(
  scheduler,
  "transactional_email_run_token",
  "transactional Vault token",
);
requireText(scheduler, "audience_sync_run_token", "audience Vault token");
requireText(
  scheduler,
  "7,17,27,37,47,57 * * * *",
  "transactional measured cadence",
);
requireText(scheduler, "3,18,33,48 * * * *", "audience measured cadence");
for (
  const trigger of [
    "enqueue_free_rsvp_confirmation_trigger",
    "profile_consent_metadata_guard_trigger",
    "profile_consent_evidence_enqueue_trigger",
  ]
) requireText(rescue, trigger, "exact rescue trigger");
requireText(
  config,
  "[functions.transactional-email-drain]\nverify_jwt = false",
  "transactional gateway posture",
);
requireText(
  audienceWorker,
  "acquire_delivery_worker_lease",
  "audience overlap guard",
);
requireText(
  audienceWorker,
  "claim_audience_contact_reconciliations",
  "provider preference reconciliation",
);
requireText(
  transactionalWorker,
  "acquire_delivery_worker_lease",
  "transactional overlap guard",
);
if (/RESEND_AUDIENCE_ID[^\n]+\?\?\s*["'][0-9a-f-]{20,}/.test(audienceWorker)) {
  failures.push("audience worker contains a hardcoded audience fallback");
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(
  `PASS: frozen G0 rollout manifest (${
    Object.keys(manifest.files).length
  } files), quarantine defaults, seed scope, scheduler separation, retention, and rescue wiring`,
);
