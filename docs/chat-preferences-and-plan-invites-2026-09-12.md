# Chat preference and plan invitation repairs

Isolated native implementation, September 12, 2026. Nothing in this package was deployed; tests used mocks and synthetic fixtures. Existing uncommitted work was preserved.

## Implemented

- Main community mute reads now fail visibly on unavailable settings, missing active membership or an unexpected account. They no longer default failures to notifications being on.
- The main mute control has checking, saved and unknown states, serializes taps and reads back a write before confirming it. An uncertain result requires a settings read before a second toggle. Topic notification writes now require a matching saved membership-row receipt.
- `useObservedUser` only observes existing authentication state. Subscribing before the initial read, identity epochs and stale-result guards prevent old account results from replacing new ones. It does not sign in/out, refresh credentials or change login routing.
- `useCommunityBroadcastMute` isolates room/account transitions, including A → B → A, and prevents a delayed background settings read from overwriting a confirmed save. Initial identity failures remain retryable.
- The saved `PingAfterPlanModal` / `PingInline` flow now keeps selections between its strip and full picker, uses one accessible photo/name checkbox per person, and has explicit send/busy/unknown/retry states. Only unconfirmed recipients remain selected after partial failure. Successful recipients are not retried. Exits are guarded while sending; late results cannot navigate a different plan/account.
- Loading errors no longer look like an empty people list. Only a successful current empty read skips the optional invitation step. Required plan creation, joining and recipient rules are unchanged.
- User-facing wording is now Invite people / Send invites. Photos retain their existing URI; no activity-ring state is repurposed as selection. The layout uses the existing native fonts/colors with flatter controls. This is not a claim that the final whole-app brand font rollout is complete.

## Important source distinction

In this saved source, `PingAfterPlanModal` is called after joining in `app/plan/[id].tsx`. Current post-creation invitations belong to `components/post/PlanComposerV2.tsx`; that path has now been repaired separately; see `post-plan-invitation-repair-2026-09-12.md`. The old swallowed-avatar-tap repair was already present. Do not claim the original live report was reproduced or that repairing the legacy overlay alone fixes every post-creation invitation.

The existing untouched invitation screen auto-dismisses after eight seconds. Any face selection, opening the picker, scrolling the strip or sending cancels that timer. This timing was retained; revisiting it is a product review item, not an undocumented logic change.

## Verification

63 targeted checks pass across five suites: mute read/write/readback (9), explicit source-aware mute policy (22), observed-identity/main-control races (12), and invitation components (20). Full noEmit TypeScript and diff checks pass. The independent room preservation rehearsal remains 19/19 synthetic tests.

The invitation components were also bundled from the actual native source with Metro and rendered through React Native Web in a local harness. Fixtures replace identity, people and sends; fonts come from the existing dependency copy. At 375×812, selection carried into See all, pending controls disabled, a simulated partial failure retained the unresolved person, and an explicit retry completed the step. At 430×932, the strip and button remained usable. Visible checkbox state and one-target semantics were inspected; the underlying strip is hidden from web accessibility navigation while the sheet is open. This does not verify iOS/Android touch, VoiceOver/TalkBack, real network delivery or the full navigation stack.

Screenshots:
- `/Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/native-invitations/375-partial-retry.png`
- `/Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/native-invitations/430-selected.png`

Temporary reproducible harness: `/private/tmp/washedup-invitation-review` (local-only port 8844). The ordinary design prototype remains on 8843. The harness is not a production app build or a Figma handoff.

## Remaining work

- Current PlanComposerV2 invitation repair passes its 28 targeted tests; complete its separate device verification.
- Provide independent Intros/main room metadata and read positions on a database copy with preservation evidence before switching old communities over.
- Wire the pure mute policy into source-aware fanout, claiming and retries. Existing queued notifications still need the server-side enforcement described in `community-mute-contract-2026-09-12.md`. The evaluator alone does not change delivery.
- Test real chat scroll/keyboard/reconnect/media behavior and OneSignal preferences on devices before release. Current main preference improvements do not establish global account-cache isolation in the other legacy chat queries.
