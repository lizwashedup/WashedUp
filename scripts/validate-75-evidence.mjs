import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const evidencePath = resolve(process.argv[2] ?? 'qa/evidence/75-threshold-device.json');
let evidence;
try {
  evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
} catch (error) {
  console.error(`FAIL: real-device evidence is missing or invalid at ${evidencePath}`);
  console.error('Copy qa/evidence/75-threshold-device.example.json only after an authorized tester performs every check.');
  process.exit(1);
}

const requiredText = ['tester', 'device', 'tested_at', 'app_version'];
const authorizedTesters = new Set(['Josh', 'Liz']);
const requiredArtifacts = ['testflight', 'chat_and_notifications', 'creator_and_tickets', 'ticket_email'];
const requiredChecks = [
  'testflight_build_37_visible',
  'app_opens',
  'topic_text_seen_by_second_account',
  'topic_photo_seen_and_notification_nonblank',
  'reply_edit_mention_reaction_persist_for_second_account',
  'archived_topic_message_and_reaction_rejected',
  'notification_tap_opens_exact_topic',
  'main_thread_photo_edit_delete_persist_for_second_account',
  'creator_space_does_not_loop',
  'created_community_lands_selected_in_creator_space',
  'draft_ticket_warning_persists_after_return',
  'on_sale_ticket_clears_warning',
  'required_ticket_questions_block_checkout_until_answered',
  'fresh_paid_checkout_email_received_once',
  'duplicate_webhook_does_not_send_second_email',
  'transient_email_failure_creates_retry_or_alert_evidence',
  'receipt_resend_is_buyer_only_and_rate_limited',
];

const failures = [];
for (const key of requiredText) {
  if (typeof evidence[key] !== 'string' || evidence[key].trim() === '') failures.push(`missing ${key}`);
}
if (evidence.build_number !== 37) failures.push('build_number must be 37');
if (evidence.app_version !== '1.0.6') failures.push('app_version must be 1.0.6');
if (!authorizedTesters.has(evidence.tester)) failures.push('tester must be Josh or Liz');
const testedAt = Date.parse(evidence.tested_at);
if (typeof evidence.test_order_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(evidence.test_order_id)) {
  failures.push('test_order_id must be the UUID from the fresh paid checkout');
}
if (!Number.isFinite(testedAt)) failures.push('tested_at must be an ISO timestamp');
if (Number.isFinite(testedAt) && Date.now() - testedAt > 7 * 24 * 60 * 60 * 1000) failures.push('device evidence is older than seven days');
if (Number.isFinite(testedAt) && testedAt - Date.now() > 5 * 60 * 1000) failures.push('tested_at cannot be in the future');
for (const key of requiredChecks) {
  if (evidence.checks?.[key] !== true) failures.push(`check is not proven: ${key}`);
}
for (const key of requiredArtifacts) {
  const artifact = evidence.artifacts?.[key];
  if (typeof artifact !== 'string' || artifact.trim() === '') {
    failures.push(`supporting artifact is missing: ${key}`);
    continue;
  }
  const artifactPath = resolve(dirname(evidencePath), artifact);
  try {
    const extension = extname(artifactPath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.mov', '.mp4'].includes(extension)) failures.push(`unsupported artifact type: ${key}`);
    if (statSync(artifactPath).size < 1024) failures.push(`supporting artifact is empty or too small: ${key}`);
  } catch {
    failures.push(`supporting artifact file does not exist: ${key}`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(`PASS: dated build ${evidence.build_number} evidence from ${evidence.tester} on ${evidence.device}`);
