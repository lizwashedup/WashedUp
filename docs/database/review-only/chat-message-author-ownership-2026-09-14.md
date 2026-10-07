# Chat author ownership — verified local candidate

The recovered Plan message INSERT policy checks that the caller joined the plan, but its Plan branch does not require the submitted `user_id` to be the caller. At 22:15 UTC on September 14, an authenticated synthetic member inserted a message using the creator's ID; a separately authenticated creator then read that persisted attribution. The unrelated-account read/send checks still rejected access. This is a verified author-impersonation gap in the captured baseline, not a reason to broaden eligibility or alter the UI.

`20260914010000_chat_message_author_ownership.sql` adds one restrictive INSERT policy for `authenticated`: the author must equal `auth.uid()`. The original membership/Circle policy, roles, RPC names, histories, read/delete behavior and service-role bypass remain intact. The candidate refuses an unexpected original-policy fingerprint. It is review-only and has been applied **only to the isolated local backend**; no remote fix or release is claimed.

Local real-client checks after application all passed: phone test OTP, normal and reconnected live delivery, durable history in a fresh session, rejecting outsider/forged/null authors, preserving own system messages and replies, image/audio message metadata, Circle member sending/reading and Circle outsider/forged-author rejection. Media upload/rendering and external notification delivery are not covered by metadata inserts. Native and supported-device regression checks remain pending.

Evidence directory: `/Users/liz/Desktop/WashedUp/Implementation/backend-recovery-2026-09-14/`.

- `chat-transport-verification.json`: original gap and an initial live message not observed within eight seconds. That message persisted and a reconnected reader received the next message. Preserve this failure; a later passing run does not establish its cause or resolution.
- `chat-transport-verification-after-author-policy.json`: 21 recorded checks, all passed, including run completion; 22:17:55 UTC start. `author-policy-apply.json` records the exact candidate hash.
- `author-policy-schema-comparison.json`: this one policy is the only public schema change; public Realtime membership is unchanged. Five internal Realtime date partitions appeared after service use. Full managed-schema compatibility remains a separate check.
- `author-policy-rollback-verification.json`: dropping the candidate inside a transaction reproduced the original gap; rolling the whole transaction back restored protection and left hashes/counts unchanged for profiles, events, event members, messages, Circles, Circle members and app notifications. This is a bounded policy rollback rehearsal, not full deployment rollback verification.

Do not remove the candidate from the active local stack to match the old baseline. Preserve the baseline snapshot separately and track this deliberate difference. Before any remote deployment, reconcile this candidate with the held migration set and complete the applicable release checks and authorization. No product decision or additional user access is needed for the next local/native verification steps.
