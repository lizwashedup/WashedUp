# Sentry and live private-chat audit — October 7, 2026

Status: authenticated read-only inspection completed; five confirmed server RPC gaps have a locally tested, review-only fix. No public release, database change, Sentry issue mutation, notification send, or phone installation was performed. No native hang fix is claimed.

## Sentry evidence

Sentry project: WashedUp / `react-native`, project `4511311773827072`. Search: all statuses, `App Hanging`, last 14 days. Three matching issues each had one matching event and one affected device identifier; these counts do not establish three distinct people. Email arrival time was not used as event time. Times below are PDT.

| Issue | Selected event | Evidence | Interpretation |
| --- | --- | --- | --- |
| [REACT-NATIVE-4R](https://washedup.sentry.io/issues/7779905348/) | October 7, 4:16:26 PM | Production OTA, iPhone 16 Pro Max / iOS 26.6.1, app 1.0.7 (51); main thread in `RCTUITextView canPerformAction:withSender:` → UIKit edit menu → pasteboard → synchronous XPC wait | Clipboard/text-selection stall; at least the 2-second reporting threshold. JavaScript thread was idle in the sampled stack. No evidence here of a chat-scroll loop. |
| [REACT-NATIVE-4N](https://washedup.sentry.io/issues/7769779093/) | October 2, 9:57:39 PM | Production channel, embedded Build 51, iPhone 17 Pro Max / iOS 26.6.1; `UIKeyboardTaskQueue` → autocorrection/predictive input | Native keyboard wait; screen and initiating application cause remain unproved. |
| [REACT-NATIVE-G](https://washedup.sentry.io/issues/7499643474/) | September 29, 4:36:59 AM | Production OTA, runtime `1.0.5`; keyboard task queue → text selection/multi-tap | Older native selection stall; do not conflate it with the newer runtime or current candidate. |

The latest event's preceding activity includes `operator_update_explore_event_with_categories` requests (one successful, one 400), background/foreground transitions, keyboard display, and a TextInput multi-tap. This suggests event-editor activity, but there is no explicit route context proving the screen. Its runtime was `2c21d65e4f9b6bad5e9823bc1886f6c3bb773ed1`, OTA update `01a11565-639d-7078-95e9-c943eb154eae`, nonembedded/nonemergency. Thermal state was nominal. A snapshot of available memory cannot rule out transient memory pressure.

The latest event is missing WashedUp executable symbols for UUID `1d18e2c9-c334-31b2-b8b3-c1cbaf61f1fa`. Framework frames still identify the clipboard wait. The exact matching archive/dSYM is needed to improve app-frame attribution; rebuilding the same source creates a different UUID. No symbols were uploaded and monitoring remains enabled.

[REACT-NATIVE-2S](https://washedup.sentry.io/issues/7644427523/) contains three recent watchdog events on one device identifier:

- October 7, 2:48:39 PM and 2:48:21 PM: **preview** OTA channel, embedded, runtime `7372210dbc5e8a842787ce277adecc3884485812`, update `1653a1b1-6f9e-4bb2-a488-9935fc7f9e0d`.
- October 6, 6:32:43 PM: **production** OTA channel, nonembedded, runtime `2c21d65e4f9b6bad5e9823bc1886f6c3bb773ed1`, update `01a0fb0d-9ba2-7511-b713-28250a169115`.

All three display environment `production`, so that tag alone misclassifies private preview activity. App version 1.0.7 (51) alone is also insufficient. The recent preview includes a 404 for the push diagnostic RPC. [Sentry documents watchdog detection as heuristic](https://docs.sentry.io/platforms/apple/guides/ios/configuration/watchdog-terminations/); the issue wording does not prove an out-of-memory cause. Do not dismiss these as normal user force-quits or claim testing caused them without further evidence.

Smallest defensible hang follow-up: reproduce text entry, autocorrection, multi-tap selection and copy/paste after background return in both the event editor and each chat composer, on the exact candidate/runtime. Capture a native main-thread trace and matching symbols if the stall recurs. Disabling copy/paste, autocorrection, hang reporting, or raising reporting thresholds would not establish a fix. Simulator success cannot exclude device-only keyboard service or watchdog behavior.

## Live blocking evidence

Supabase project visibly verified: **WashedUp App / main Production / `upstjumasqblszevlgik`**. Only `SELECT` queries against catalogs were executed; no member rows, messages, tokens, notification recipients, or block records were read. DDL was exported to local fixtures with its original definition fingerprints. No schema changes were applied.

Already protected: `get_or_create_dm` and `get_person_profile` check `yours_is_blocked_between`, which combines `user_blocks` and `profiles.blocked_users` in both directions. This does not prove how any particular person discovered a profile.

Confirmed gaps:

1. Direct messages/reaction RLS retains joined membership as sufficient access after a block.
2. `get_circle`, `get_circle_chat_messages`, and `get_my_circle_chat_cards` are security-definer routines without block guards. They can return retained history, participant photos and inbox previews even when restrictive message RLS is added.
3. `edit_own_chat_message` and `edit_own_chat_message_with_mentions` are security-definer routines without block guards. Their existing membership/ownership checks alone permit editing retained DM history after a block.

The policy candidate now has a companion, `docs/database/review-only/20261007140000_private_chat_rpc_block_boundary.sql`. It inserts only access guards into the five exact reviewed function definitions, preserving signatures, ownership, grants, account holds, edit conflict checks, event windows and existing response structures. If any source fingerprint differs, its transaction aborts rather than overwrite newer production code. Both files remain outside active migrations and are **not deployed**. Promotion must combine the policy and RPC changes atomically after fresh drift review; do not ship only the first file.

The boundary follows existing app semantics: unnamed/whitespace-name two-person Circle chats are DMs; named or larger Circles keep group behavior. It does not introduce an immutable DM type, hide all shared-group history, retract previously downloaded photos, or change public profile/storage visibility. Rename/member-count transitions, other direct membership endpoints, active Realtime sessions, and deployed notification dispatch need review before asserting a universal block guarantee. A transaction snapshot cannot retract data returned before a block committed.

Notification catalog follow-up: live `get_member_chat_push_targets` has fingerprint `27de9aabc10cc24c29d146f5d55d2329`, denies member execute, allows service-role execute, and contains the actor/recipient `yours_is_blocked_between` predicate. Live `notify_message_reaction` contains that predicate too. The inspected `notify_new_chat_message` and `notify_new_circle_message` definitions contain no direct call to that helper. This establishes some server guard presence, not the deployed Edge Function path, actor provenance for old notices, or end-to-end push behavior. No notification function was invoked.

`push_registration_state` and `record_push_registration_state` are absent in the live catalog. The source migration already exists in the push candidate but has not been deployed by this task. This explains the observed diagnostic 404; it does not, by itself, establish that OneSignal registration failed.

## Local checks and boundaries

- **210 SQL assertions passed** in fresh PostgreSQL 17.11 on a temporary Unix socket with network listeners disabled. No database URL or production credentials are accepted by the runner.
- Tests first reproduce direct-table and all five security-definer bypasses, then execute the exact exported RPC bodies with the proposed guards. They cover both block stores/directions/viewers, history, avatars/previews, reactions, edits, named pairs/groups/events, unblocked behavior, outsiders, sender ownership, edit conflicts, suspended accounts, cancelled events and preserved execute grants.
- A simulated live-source change proves the patch rejects drift and rolls back routines already changed earlier in the transaction.
- The mention parser is an explicit fixture stub; this pass does not certify production mention parsing. The schema is a focused column fixture, not a full production clone. Existing direct-table tests deliberately use permissive legacy RLS to test the restrictive boundary.
- The expanded catalog SELECT runs locally, including long edit-RPC signatures without the prior PostgreSQL `name` truncation.
- Application TypeScript/Jest/export results from the earlier combined-source check remain applicable because this pass changes only review SQL, test fixtures/scripts and documentation. Required Docker checks and existing baseline Jest failures remain unresolved as documented in the combined-candidate record.

Evidence: `/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/combined-candidate-20261007/block-sql-contract-live-rpcs.log` and `live-private-chat-routines.json`. The repository fixture contains function definitions only; no private user telemetry or user rows were committed. These database-only guards introduce no native-build requirement and cannot be delivered by an Expo OTA.
