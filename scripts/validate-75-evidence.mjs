import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';

const evidencePath = resolve(process.argv[2] ?? 'qa/evidence/75-threshold-device.json');
const releasePath = resolve(process.argv[3] ?? 'qa/evidence/75-threshold-release.json');
let evidence;
let release;
try {
  evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
} catch (error) {
  console.error(`FAIL: real-device evidence is missing or invalid at ${evidencePath}`);
  console.error('Copy qa/evidence/75-threshold-device.example.json only after an authorized tester performs every check.');
  process.exit(1);
}
try {
  release = JSON.parse(readFileSync(releasePath, 'utf8'));
} catch (error) {
  console.error(`FAIL: release evidence is missing or invalid at ${releasePath}`);
  console.error('Copy qa/evidence/75-threshold-release.example.json only after the reviewed EAS build finishes.');
  process.exit(1);
}

const requiredText = ['tester', 'device', 'second_account', 'tested_at', 'operator_canaries_tested_at', 'app_version'];
const authorizedTesters = new Set(['Josh', 'Liz']);
const requiredArtifacts = ['testflight', 'chat_and_notifications', 'creator_and_tickets', 'ticket_email', 'operator_canaries'];
const requiredDeviceChecks = [
  'app_opens',
  'topic_text_seen_by_second_account',
  'topic_photo_seen_and_notification_nonblank',
  'reply_edit_mention_reaction_persist_for_second_account',
  'notification_tap_opens_exact_topic',
  'main_thread_photo_edit_delete_persist_for_second_account',
  'creator_space_does_not_loop',
  'created_community_lands_selected_in_creator_space',
  'draft_ticket_warning_persists_after_return',
  'on_sale_ticket_clears_warning',
  'required_ticket_questions_block_checkout_until_answered',
  'fresh_paid_checkout_email_received_once',
  'brand_new_account_otp_reaches_verification',
  'affected_signup_user_retry_confirmed',
  'affected_final_seat_user_retry_confirmed',
];
const requiredOperatorChecks = [
  'archived_topic_message_and_reaction_rejected',
  'duplicate_webhook_does_not_send_second_email',
  'transient_email_failure_creates_retry_or_alert_evidence',
  'receipt_resend_is_buyer_only_and_rate_limited',
];
const mediaArtifactTypes = new Set(['.png', '.jpg', '.jpeg', '.mov', '.mp4']);
const operatorArtifactTypes = new Set([...mediaArtifactTypes, '.txt', '.md', '.json']);

const failures = [];
for (const key of requiredText) {
  if (typeof evidence[key] !== 'string' || evidence[key].trim() === '') failures.push(`missing ${key}`);
}
if (!Number.isInteger(release.build_number) || release.build_number < 1) failures.push('release build_number must be a positive integer');
if (typeof release.app_version !== 'string' || release.app_version.trim() === '') failures.push('release app_version is missing');
if (typeof release.eas_build_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(release.eas_build_id) || /^0{8}-0{4}-4000-8000-0{12}$/i.test(release.eas_build_id)) failures.push('release eas_build_id must be the real EAS build UUID');
if (typeof release.reviewed_commit !== 'string' || !/^[0-9a-f]{40}$/i.test(release.reviewed_commit) || /^0{40}$/.test(release.reviewed_commit)) failures.push('release reviewed_commit must be the real full commit SHA');
const releaseRecordedAt = Date.parse(release.recorded_at);
if (!Number.isFinite(releaseRecordedAt)) failures.push('release recorded_at must be an ISO timestamp');
if (Number.isFinite(releaseRecordedAt) && releaseRecordedAt - Date.now() > 5 * 60 * 1000) failures.push('release recorded_at cannot be in the future');
if (evidence.build_number !== release.build_number) failures.push('device build_number must match release evidence');
if (evidence.app_version !== release.app_version) failures.push('device app_version must match release evidence');
const buildVisibilityCheck = `testflight_build_${release.build_number}_visible`;
if (evidence.device_checks?.[buildVisibilityCheck] !== true) failures.push(`device check is not proven: ${buildVisibilityCheck}`);
if (!authorizedTesters.has(evidence.tester)) failures.push('tester must be Josh or Liz');
const testedAt = Date.parse(evidence.tested_at);
const operatorTestedAt = Date.parse(evidence.operator_canaries_tested_at);
if (typeof evidence.test_order_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(evidence.test_order_id) || /^0{8}-0{4}-4000-8000-0{12}$/i.test(evidence.test_order_id)) {
  failures.push('test_order_id must be the UUID from the fresh paid checkout');
}
if (!Number.isFinite(testedAt)) failures.push('tested_at must be an ISO timestamp');
if (Number.isFinite(testedAt) && Date.now() - testedAt > 7 * 24 * 60 * 60 * 1000) failures.push('device evidence is older than seven days');
if (Number.isFinite(testedAt) && testedAt - Date.now() > 5 * 60 * 1000) failures.push('tested_at cannot be in the future');
if (!Number.isFinite(operatorTestedAt)) failures.push('operator_canaries_tested_at must be an ISO timestamp');
if (Number.isFinite(operatorTestedAt) && Date.now() - operatorTestedAt > 7 * 24 * 60 * 60 * 1000) failures.push('operator canary evidence is older than seven days');
if (Number.isFinite(operatorTestedAt) && operatorTestedAt - Date.now() > 5 * 60 * 1000) failures.push('operator_canaries_tested_at cannot be in the future');
for (const key of requiredDeviceChecks) {
  if (evidence.device_checks?.[key] !== true) failures.push(`device check is not proven: ${key}`);
}
for (const key of requiredOperatorChecks) {
  if (evidence.operator_checks?.[key] !== true) failures.push(`operator check is not proven: ${key}`);
  if (typeof evidence.operator_evidence?.[key] !== 'string' || evidence.operator_evidence[key].trim() === '') {
    failures.push(`operator evidence note is missing: ${key}`);
  }
}
for (const key of requiredArtifacts) {
  const artifact = evidence.artifacts?.[key];
  if (typeof artifact !== 'string' || artifact.trim() === '') {
    failures.push(`supporting artifact is missing: ${key}`);
    continue;
  }
  const evidenceDirectory = dirname(evidencePath);
  const artifactPath = resolve(evidenceDirectory, artifact);
  try {
    if (!artifactPath.startsWith(`${evidenceDirectory}${sep}`)) {
      failures.push(`supporting artifact escapes the evidence directory: ${key}`);
      continue;
    }
    const extension = extname(artifactPath).toLowerCase();
    const supportedTypes = key === 'operator_canaries' ? operatorArtifactTypes : mediaArtifactTypes;
    if (!supportedTypes.has(extension)) failures.push(`unsupported artifact type: ${key}`);
    if (statSync(artifactPath).size < 1024) failures.push(`supporting artifact is empty or too small: ${key}`);
  } catch {
    failures.push(`supporting artifact file does not exist: ${key}`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(`PASS: dated build ${evidence.build_number} device and operator evidence from ${evidence.tester} on ${evidence.device}`);
