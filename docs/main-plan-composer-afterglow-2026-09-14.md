# Main plan composer — optional Afterglow, 2026-09-14

Local isolated implementation in `components/post/PlanComposerV2.tsx`. The existing development flag `COMMUNITY_CHAT_GROUPING_ENABLED` selects Afterglow fonts, cream/ink/clay colors, sentence-case labels, compact four-point corners, visible required labels and 44-point minimum controls. The default presentation and native bottom navigation are retained. No flag, database contract, provider configuration or live plan was changed.

## Presentation and component contract

The composer passes `{ fonts: AfterglowFontFamilies }` to the existing title, category, date, time, place and nudge controls; invitation suggestions and the accepted-people selector; confirmation, plan share and alert components. It does not add steps or replace their underlying callbacks. The people picker’s existing `user_id`, name and photo, and a real optional handle when supplied, remain attached to the selected invitation chip. The want-in source supplies no handle, so none is invented.

The sticky footer uses a short plan summary and a single row for Post plan and the existing flag-gated Save draft action. Summary text may truncate there; the editable title remains available above. Staged metadata preserves the actual capitalization of names, places and AM/PM in both the footer and confirmation. The optional neighborhood sheet adds a visible Close action, labelled radio options and the same existing selection/dismissal behavior. Message and description now visibly say required in the staged presentation, and the description placeholder no longer implies that it is optional. The previous opening source comment incorrectly described those fields as optional; the comment was corrected to match the actual validator.

The related shared-component changes are owned by the parallel composer package. `PostConfirmation` continues distinguishing a plan write in progress, a confirmed plan, a pending invitation request and an unconfirmed invitation request. Optional styling does not turn an acknowledgement into a delivery guarantee. `SharePlanModal` keeps the existing slug-or-ID link and native share payload.

## Existing product rules preserved

- Post requires title, selected day and time, category, a creator message of at least 10 characters, and a nonempty description. The existing title control defaults to 80 characters; message and description retain their 150- and 2,000-character limits.
- Draft requires title, day and time. It retains content/date validation and the original draft insert/update paths, without creator membership or invitation dispatch. `COMMUNITIES_ENABLED` still controls whether the draft action appears.
- Date/time remain Los Angeles wall time, preserving exact minutes and the existing daylight-saving validation. End time remains optional; overnight resolution is retained, and a posted end time must be at least 30 minutes after its start. The future-start rule stays in the posting path.
- Place, photo, end time, link/tickets and neighborhood stay optional. A detected description URL still requires an explicit action to move it to the link field.
- Total group size remains 3–8 including the creator (2–7 invite slots). Original default capacity, minimum-invites payload and drop-in/copy defaults stay the same.
- Mixed is always present. The account’s existing gender value controls whether its matching women-only, men-only or nonbinary-only option appears. Age selection, including the original two-range limit and All Ages reset, is unchanged.
- Plan/draft payload fields, creator ownership, admission/membership semantics, privacy, post/share destinations and pre-attached invitation IDs are unchanged. Post still follows event write → creator membership with the existing retry/rollback → original duplicate notification and invitation sequence. Invitation retry reuses the saved plan and recipient snapshot.

The earlier post/account repair is documented in `plan-composer-account-lifetime-2026-09-13.md`; its generic field/place callback and server-atomicity limits remain. This package supersedes that document’s statement that photo lifetime still needs its own audit.

The final independent review confirmed a preexisting cold-entry Cancel failure: direct entry to the Post tab can have no back stack, leaving Cancel inert. Cancel now goes back when available and otherwise returns to the existing Plans route. Both exits retire pending photo work first; this does not add another creation route or discard a confirmed photo.

## Photo lifetime repair

The original image chain opened permissions and the picker without a synchronous lock, then authenticated only later during upload. This could overlap attempts, adopt a different account’s identity, or attach a prepared/uploaded image after leaving the composer.

The contained repair now:

1. Captures the initiating observed account, focused visit and exact attempt before requesting permission, with an immediate lock shared by photo selection and the post/draft guards.
2. Checks that ownership after permission, native selection, image preparation, authentication, session refresh and upload. Only a focused visit establishes a photo entry; an account change while blurred cannot re-enable picking.
3. Requires the same authenticated user before and after the existing refresh, before upload dispatch. The original `event-images` bucket, user-prefixed timestamp path, 1200-pixel JPEG preparation, 0.85 compression and crop options remain.
4. Retires on cancel/back, blur, account generation change or unmount. A pending local preview is removed on departure; an already confirmed HTTP photo remains part of the draft on blur/refocus.
5. Suppresses a retired success, error or finalizer so it cannot change the new attempt’s photo, error or loading state. Permission denial, chooser cancellation, chooser failure, invalid preparation and upload failure each release the current attempt for a deliberate retry.

Failure to open the native picker says “Couldn’t open photos”; it does not claim that an unselected image was invalid. Existing format and upload failures remain distinct.

These are local dispatch and presentation safeguards. An upload already sent may finish after retirement and cannot be retracted by this client. No orphan-photo cleanup, storage policy change or atomic account/token binding inside Supabase’s transport was added.

## Verification

```sh
npx jest --runInBand --ci components/post/__tests__ components/modals/__tests__/SharePlanModal.test.tsx
npx tsc --noEmit --pretty false
git diff --check -- components/post/PlanComposerV2.tsx components/post/__tests__/PlanComposerV2.invites.test.tsx docs/main-plan-composer-afterglow-2026-09-14.md
```

The composer suite has **47 passing cases**, including its original 20 invitation/account cases. Added checks cover gated appearance propagation and default preservation, required fields/limits, unchanged payload and gender/capacity selection, draft-only gates, real selected handles, original image preparation/upload parameters, immediate duplicate/post/draft locking, A→B→A, cancel/blur/unmount, blurred account transitions, delayed native/preparation results, pre/post-refresh owner mismatch, old/new upload overlap and explicit retry.

The combined run passed **99 tests in 6 suites**. Full TypeScript and the scoped diff check passed. Service boundaries are mocked: this is not verification of real plan creation, storage upload, push delivery, native share destinations or physical-device keyboard/picker behavior. Root owns the separate actual-component browser fixture and visual evidence.

## Confirmation and browser verification

The optional confirmation uses “Your plan is live” (or the first-plan version), a fully wrapping title/meta card, and Share plan/View plan. It preserves pending-plan and invitation-request states, and has a safe-area scroll container so both actions remain reachable on short screens. The previous duplicate-exit gap is repaired: a visible confirmation claims one exit synchronously, with the same plan-ready and invitation guard before dispatch. Retired and unmounted callbacks cannot navigate. Legacy presentation stays available.

Root checked actual components in the local browser fixture at 320/375/430 widths, including a 320×440 long-title confirmation. Required-field feedback, handle lookup/selection, save failure/retry, invitation failure/retry with one retained plan, draft saving without message/description, photo retry, simulated sharing and the cold-entry Cancel fallback were observed. The invitation retry example retained one saved plan through two request attempts. This does not establish real delivery or unknown server-write recovery.

Evidence: `Design/Shared Experience - Round 1/verification/plan-composer/VERIFICATION.md`. The local review defaults to the normal new-plan form; failures are labelled simulations. The fixture enables the existing community-gated Save draft action only for this form. No native feature flag is changed.
