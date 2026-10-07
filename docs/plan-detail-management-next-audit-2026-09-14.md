# Plan detail: next management package audit

Date: 2026-09-14. Read-only review of the isolated native source and checked-in SQL. Only this document was changed. No database, network, external invitation, notification, photo upload, or native action was executed.

The next package should first make leave and cancellation report the actual result, then protect the creator’s edit draft, and then make ordinary waitlist and direct invitation actions reliable. These are existing gaps in the legacy management paths, also present in `HEAD`; the completed overview/joining port did not establish their correctness. The new joining, participation notice, and waitlist-exception controllers are separate work and are not reopened here.

## What the saved contracts establish

| Action | Current route write | Checked-in contract and receipt boundary |
| --- | --- | --- |
| Edit | `events.update(payload).eq(id).eq(creator_user_id)` | Direct PostgREST update, currently without a selected row or count. The route checks returned `error`, but `error: null` alone cannot distinguish an affected plan from a zero-row update. The complete original events UPDATE policy and original table constraints are not captured in the migrations reviewed. |
| Cancel | `events.update({status: 'cancelled'})` with the same owner filters | The route ignores returned `error`. A successful transition can run terminal waitlist cleanup and notification side effects; it is distinct from the subsequent optional chat insert. |
| Leave | `event_members.update({status: 'left'}).eq(event_id).eq(user_id)` | The route ignores returned `error`. The saved self-row SELECT policy permits reading one’s own membership after leaving, but the original UPDATE policy and all count-trigger bindings are not captured. A returned own row with `status: 'left'` would be a useful explicit confirmation; do not infer the write from the public joined-member list disappearing. |
| Join/leave ordinary waitlist | Insert/delete `event_waitlist` for `(event_id, user_id)` | Unique `(event_id, user_id)`; authenticated users may select, insert, and delete their own row. Current calls ignore `error` and request no row receipt. Inserting is not admission to the plan. |
| Accept/decline direct invitation | `plan_invites.update({status, updated_at}).eq(id)` | Status is `pending`, `accepted`, or `declined`. Recipient may update; sender and recipient may select. Unique key is **event + sender + recipient**, so multiple pending invitations to one plan/person are legal. Current calls ignore `error` and request no receipt. Acceptance does not create membership. |
| Next time | `send_interest_signal({p_event_id})` | Latest saved definition returns a signal UUID, including an existing active signal’s UUID; it raises for unauthenticated, missing plan, creator, ended plan, already joined, or blocked pair. The route checks `error` but discards the returned UUID. |

Relevant source files:

- `app/plan/[id].tsx`: `leaveMutation`, `interestMutation`, `openManageModal`, `pickEditImage`, `uploadEditPhoto`, `handleSaveEdit`, `handleCancelPlan`, `handleJoinWaitlist`, pending invitation read and inline actions.
- `supabase/migrations/20250228000000_event_waitlist.sql`: table, unique key, and own-row RLS.
- `supabase/migrations/20260303000000_plan_invites.sql`: table, status constraint, unique key, recipient UPDATE and sender SELECT policies.
- `supabase/migrations/20260303300000_notify_invite_accepted.sql`: accepted transition queues an `invite_accepted` notification whose title says the recipient “can come!”
- `supabase/migrations/20260401000000_fix_full_status_bugs.sql`: ordinary capacity is `max_invites + 1`; spot-open notification trigger recounts joined members, queues unnotified waitlist users, and marks them notified. It does not establish delivery to everyone.
- `supabase/migrations/20260408000000_fix_waitlist_silent_removal.sql`: confirmed membership removes own waitlist row; cancellation notifies waitlisted users, removes waitlist rows, and expires unread spot notifications; completion clears the queue without that cancellation notification.
- `supabase/migrations/20260518220000_waitlist_exceptions_rpcs_waitlister.sql`: saved `notify_creator_waitlist_join` body queues the separate `waitlist_request` notification. Its comments/assertion expect an existing INSERT trigger; do not mistake those for a full migration baseline.
- `supabase/migrations/20260908010000_block_ended_plan_entries.sql`: a waitlist insert for a cancelled/completed/time-ended plan raises `P0001` / `plan_ended`; a membership transition into joined has the corresponding guard.
- `supabase/migrations/20260813200000_event_members_anon_read_rls_fix.sql`: own-row membership SELECT, explicitly limited reconstruction of the preexisting schema.

These are saved definitions, not evidence that any migration or policy is deployed. In particular, review-only SQL and comments describing prior production observations do not prove the current server state. No complete event UPDATE or event-chat INSERT policy inventory was available in this bounded source review; those need contract verification before claiming server-level guarantees.

## Prioritized, demonstrated defects

### 1. Leave, cancel, waitlist, and direct invitations can claim success after a rejected write — P1

Each action awaits a Supabase builder but ignores its returned `{error}`. A resolved `{data: null, error: ...}` therefore follows the success branch. A cancelled-plan waitlist rejection from the saved `plan_ended` trigger is a concrete example: the route marks `isOnWaitlist=true` and announces success anyway. Cancel can insert a cancellation message and navigate back after the plan update was denied. Leave can insert “had to leave the plan” even though membership remained joined. A failed invite response disappears from the UI and may open joining.

For leave and cancel, the opposite failure also exists: if the primary write succeeds and the later chat insert rejects its promise, the entire operation is reported as failed. Retrying can repeat an already completed action and its message. Returned chat errors are currently ignored altogether. Membership/cancellation must become final once confirmed; optional chat delivery needs separate, truthful feedback and no automatic resend.

Smallest repair: use narrowly scoped action functions that check returned errors and selected receipt shape, distinguish confirmed primary success from optional message uncertainty, and keep current UI feedback separate from original-resource invalidation. A zero-row update must not dismiss the edit or announce success. A transport-unknown result must not blindly replay the whole action. A negative read while an earlier request may still be committing is not proof that it failed.

Tests: resolved error, rejected transport, empty update receipt, exact successful row, primary success followed by returned/rejected message error, and rapid double confirmation. Verify that failed primary writes never send a system message or navigate.

### 2. Management writes and photo work lack edit/visit ownership — P1

The keyed route now retires UI across account/target changes, but it does not cancel old async work. These management handlers do not capture/check a focused visit or edit session, do not freshly verify the intended account before dispatch, and use render state rather than a synchronous lock. Retained confirmation callbacks can still dispatch. An old cancellation completion can call `router.back()` from another screen. Same-account close/reopen is also enough: a pending Save can close the newly opened editor and overwrite its feedback. Manage close/back, Post this again, Cancel this plan, and fields remain usable during Save.

The photo gap begins before upload: permission, chooser, and manipulation are unguarded while `editImageLoading` remains false. Save can submit during those stages. The photo callback may later overwrite another edit visit, and `uploadEditPhoto` accepts whatever account `getUser()` returns instead of comparing it with the initiating account. Permission/chooser rejections fall outside the catch. The existing URI helper prevents persisting a local URI but cannot prevent these races; failed replacement clears the draft photo rather than preserving the last confirmed image.

Smallest repair: reuse the ownership pattern already established in the main composer and own-profile editor—one immutable account/plan/edit/visit scope, immediate action/photo locks, rechecks after each preflight await, exact current-only completion, and pending-save exit protection. Hold the photo lock from permission through upload. Preserve the confirmed photo until a replacement has succeeded; only explicit Remove should clear it. Keep original image resizing, storage bucket, payload fields, and routes.

Tests: old Save after close/reopen; blur/refocus and A→B→A; old Cancel confirmation; double Save/Cancel; Save during chooser/manipulation; chooser rejection; upload failure; Remove versus stale upload; account change between `getUser` and refresh/upload. Verify no stale navigation, upload dispatch, or draft mutation.

### 3. Direct invitation acceptance notifies “can come” before joining — P1

The inline Accept invite action writes `status: 'accepted'` and only then opens `PlanJoinSheet`. The saved accepted-status trigger immediately tells the sender that the recipient “can come!” The person may then close the required introduction, decline participation, encounter full/not-eligible, or get an unresolved join receipt. The invite is already accepted in all of those cases. Merely adding error handling does not fix this sequence.

Smallest repair: keep the intended invitation ID during the existing introduction/participation flow and finalize that invitation only after confirmed membership. A failed invitation update after successful membership is a separate response failure and must not retry membership. Retire the pending invitation intent with the same account/plan/visit as joining. Preserve the existing join requirements and server admission rules. Do not auto-accept all invitations for the event without a deliberate rule.

The decline sentence “We won’t tell them” also overpromises: sender SELECT policy exposes declined status. Remove that privacy promise; absence of a decline push does not make the response private.

Tests: backing out and denial/unknown joining leave invite pending; confirmed membership finalizes the exact invitation once; invite-write failure keeps confirmed membership; decline returned error keeps actionable state; account/plan retirement blocks the old reply.

### 4. Waitlist and invitation reads can erase or misrepresent actionable state — P2

- `refreshWaitlistState` ignores read errors and treats missing data as not waitlisted. Its only cancellation boundary is focus cleanup. An earlier in-focus read can finish after a successful waitlist insert/delete and restore the old state. Waitlist mutations do not retire that read, refetch the authoritative record, or invalidate the existing waitlist collections.
- Pending invite lookup calls `maybeSingle()` without ordering/limit on event + recipient + pending. Two allowed sender rows produce a multiple-row error and `null` data; the route hides both invitation actions. The read is an account/ID effect, not a focus refresh, so an invitation acted on elsewhere may remain stale after return.
- Waitlist toggle retries derive their operation from mutable local `isOnWaitlist`; an uncertain result must retain the original intended membership state rather than flip it on another tap.

Smallest repair: preserve loading/error/known-empty distinctly; supersede stale reads after writes; refresh on current focus; choose a deterministic pending invitation with an explicit limit while preserving its ID and recipient. Confirm desired waitlist state and invalidate original waitlist/manager/inbox collections as applicable. Do not broaden ordinary waitlist availability to full Circle plans.

Tests: read failure, deferred pre-write read resolving last, two different senders, return from inbox after a response, duplicate waitlist constraint, and retry of the original desired state after uncertain or failed results.

### 5. Reopening Manage can apply an abandoned Featured change — P2

`openManageModal` seeds the ordinary fields, but Featured toggle/type/capacity are only seeded in the plan-query effect. Toggle Featured, close without saving, reopen, then save a title: the old unsaved Featured value is still in the draft and enters the payload. Conversely a background query change can reset those fields during an active edit. Seed all editable fields from one opening snapshot and keep that draft independent of later read refreshes; only confirmed Save or explicit reopening should replace it.

Tests: toggle/type/capacity changes then close/reopen; background refresh during an edit; ordinary title-only Save leaves Featured fields unchanged.

### 6. Some current edit controls do not preserve the plan’s actual rules — P2

- **Circle capacity:** Circle creation stores legacy `max_invites=15`; `join_circle_plan_atomic` enforces `stranger_cap` only for nonmembers and never caps Circle members by `max_invites`. Manage nevertheless shows the ordinary total-person stepper, seeds it with 15, and writes it back. It can display 16 people total and decrement that number, yet this never changes the public stranger allowance. Do not clamp a Circle to eight or map stranger capacity onto total capacity. The smallest honest first step is to keep ordinary capacity editing off Circle plans while preserving stored fields; a later Circle-specific editor must use actual Circle context and existing public cap rules.
- **Age preservation:** `minMaxToAgeRanges` maps any unrepresentable saved bounds (for example 25–35 or one-sided 21+) to All Ages, and Save always writes `null/null`. A title-only edit therefore removes those saved restrictions. Preserve raw bounds unless the user explicitly changes the age control; the saved create RPC accepts age bounds independently of these UI buckets.
- **Start/end relationship:** Save changes `start_time` while leaving a non-null `end_time` untouched. Moving a plan past its former end creates an inconsistent proposed payload and the app’s end-aware logic can still treat it as ended. Preserve a valid existing duration when moving both, or expose/validate the existing end explicitly; do not silently invent a duration for null end times. No complete table constraint baseline was available to claim whether the server accepts or rejects that payload.
- **Location:** autocomplete text edits are not wired to `editLocation`; only selecting a prediction updates saved name/coordinates. A typed/cleared visible field can save the old location. Keep text and selected coordinates consistent—editing free text must clear stale coordinates, with required-place validation if selection is necessary.
- **Message copy:** the UI says minimum 10 characters and maps every `events_host_message_length` violation to “at least 10.” The checked-in replacement constraint allows null or at most 150, with no minimum. Keep any intended client minimum explicit and consistent with creation; do not describe a maximum violation as a minimum failure or use old constraint names as semantic receipts.

Focused payload tests should exercise no-op and title-only edits for each preserved field, a Circle with more than eight actual members, custom age bounds, a future start beyond an explicit end, typed versus selected location, and exact known constraint errors.

### 7. Cancellation and departure copy/navigation need the actual terminal/chat state — P2

Cancellation invalidates feed/Yours but not the detail or members caches, then calls `router.back()` without the route’s existing cold-entry Plans fallback. The current detail derives ended state from time only, so a future cancelled row can still expose management, join, waitlist, and Next time when revisited or refreshed. The saved entry trigger rejects joining/waitlisting, but the UI should recognize a confirmed cancelled/completed status rather than invite an impossible action. Use authoritative terminal status in action readiness and invalidate the original detail/context collections after confirmed cancellation.

Leave copy promises that a spot opens and everyone is notified. Circle-member departure does not necessarily open a public stranger spot, and the saved ordinary trigger only queues specific waitlist recipients. Cancel/leave also always insert an event-parented message; whole-circle plans with `has_own_chat=false` coordinate in the Circle conversation, so that event message is not in the chat reached from this screen. Use truthful primary-action copy and the established coordination parent if an optional announcement is supported. Do not send duplicate messages to both conversations or infer recipient delivery from an insert receipt. A change to server-authored system messages requires the missing policy/trigger contract review; the local package must not claim it has completed that backend work.

Tests: cancelled future plan on fresh/cached detail; confirmed cancellation then cold return; confirmed leave with unknown message delivery; private Circle versus public outsider capacity; correct single chat parent or explicitly omitted optional announcement.

## Auxiliary Next time audit

The generic button currently requires only plan + signed-in viewer + noncreator + nonmember + not time-ended + no active signal. It does not require known successful interest/membership reads, validated Circle visibility, or active plan status. Read errors are silently interpreted as no signal; mutation success ignores the RPC’s UUID receipt.

The latest saved `send_interest_signal` body is in `20260611000100_interest_signal_reshow_fix.sql`, replacing the earlier definitions in `20260504100000_event_interest_signals.sql` and `20260504110000_update_interest_signal_body.sql`. It is `SECURITY DEFINER`, derives the caller from `auth.uid()`, and has no Circle visibility/member or cancelled-status check. Direct signal-table writes have no RLS policy; this RPC is the write door. Existing active signals return before notification, but two concurrent first sends can both reach the upsert and notification branch. Do not claim arbitrary retry is exactly once.

The synthetic private-Circle outsider rendering confirms the UI gate’s absence; it does **not** prove an outsider can retrieve that private plan on the deployed server. The original events SELECT baseline is unavailable here. Nonetheless the saved security-definer RPC itself supplies no private-Circle boundary when given a known event ID. Document that as a server-policy follow-up, not a newly verified live exploit.

Smallest native repair: require current confirmed read/context state, suppress outward interest for a known private Circle outsider and terminal plan, check a UUID success receipt, and use a synchronous scoped action lock. Preserve the ordinary feature’s independent “another time” semantics: do **not** simply reuse age/gender/current-capacity admission eligibility as the interest rule. Tests should compare ordinary full/age-ineligible plans with private Circle outsider, Circle member, unknown context, cancelled plan, failed reads, duplicate taps, and account/visit retirement. Any server restriction change needs a reviewed SQL contract with the same intended visibility rule; no SQL change was made in this audit.

## Suggested delivery order and boundaries

1. Repair primary receipts and phase separation for leave/cancel, with scoped confirmation and cold-entry navigation. Add the small terminal-state gate at the same boundary.
2. Port Manage appearance while establishing one draft lifetime, safe photo replacement, and payload preservation. Keep unsupported Circle capacity controls out of this first pass.
3. Repair ordinary waitlist reads/writes and direct invite lookup/response, integrating invite finalization with the already-confirmed joining callback. Keep waitlist-exception admission in its existing controller.
4. Complete the auxiliary interest gate/receipt work and record the remaining saved server visibility policy gap.

No new global mutation framework, admission algorithm, notification channel, or schema rewrite is needed for the native package. The existing ownership primitives, exact record IDs, receipt-aware controllers, and actual-component deferred-promise tests are appropriate patterns. Each phase should retain the original successful user journey and separately expose a failed or unresolved side effect. No tests were run for this documentation-only audit; the cases above are targeted implementation suggestions, not reported passing coverage.
