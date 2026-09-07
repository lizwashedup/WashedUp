# 75-organization evidence checklist

The gate is green only after Build 41 is the reviewed TestFlight artifact, the real-device and operator
evidence below is complete, and `npm run qa:75:live` exits zero. Never pre-check a field or reuse an old
artifact.

## Before the walkthrough

1. Finish and commit the reviewed release. The working tree must contain no runtime changes.
2. With separate approval, build and submit the production iOS artifact.
3. After EAS finishes, copy `75-threshold-release.example.json` to `75-threshold-release.json` and record
   the real EAS build ID, build number, app version, reviewed commit, and timestamp.
4. Confirm TestFlight exposes that exact build to Josh or Liz.

## Real-device evidence

Josh or Liz must be the named tester. Use a physical iPhone and a second account. Record the TestFlight
screen, the chat and notification walkthrough, the creator and ticket walkthrough, and the one real inbox
confirmation. The walkthrough covers every `device_checks` field in the example manifest, including a
fresh-account OTP round trip and the two affected-user retry confirmations required by the release plan.

The checkout uses a real card and sends a real provider email. It needs separate paid-action approval.
Record the resulting `ticket_orders.id` UUID. Do not put card data, OTP codes, access tokens, email
addresses, phone numbers, or other credentials in an artifact.

## Controlled operator evidence

The archived-topic rejection, duplicate-webhook idempotency, transient-email retry or alert, and receipt
resend authorization and cooldown checks require controlled operator canaries. They are not casual phone
taps. Run them only with the specific production-action approval each canary requires. Save a sanitized
text log with timestamps and outcomes in `artifacts/operator-canaries.txt`, and summarize each result in
`operator_evidence`. Do not include credentials or private customer data.

## Final checks

1. Copy `75-threshold-device.example.json` to `75-threshold-device.json` only after the checks are real.
2. Put every referenced artifact under `qa/evidence/artifacts/` and keep each file larger than 1 KB.
3. Run `node scripts/validate-75-evidence.mjs qa/evidence/75-threshold-device.json qa/evidence/75-threshold-release.json`.
4. Run `npm run qa:75:live`. Only exit zero clears outreach to the 75 organizations.
