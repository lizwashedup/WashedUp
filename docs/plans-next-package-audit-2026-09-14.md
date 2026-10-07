# Plans: next staged package audit — 2026-09-14

Read-only audit of the isolated native source before the bounded adapter repair noted below. No backend, UI, provider or production calls. The accepted title-first `PlanCard` remains the default.

## Recommendation

Next visual package: **Plans discovery list and its filters**, using the already implemented optional card appearance. Own `app/(tabs)/plans/index.tsx`, optional presentation in `components/plans/FeaturedEventCard.tsx`, `components/plans/WhenCalendarSheet.tsx` and `components/FilterBottomSheet.tsx`, and pass the existing calendar/card appearance. Preserve the list’s data, filters, grouping, original map route and card destinations. The shared filter sheet also serves other screens; defaults must remain unchanged.

Treat plan detail + joining as the following coherent package. Its 4,160-line route includes member/creator/exception states and several mutations, so it should not be folded into a typography-only discovery pass. The map surface, MiniProfileCard, save/share overlays and welcome/profile-completion prompts remain explicit follow-ups unless included and verified in the discovery package; a new feed screenshot would not complete those flows.

## What is already staged versus still legacy

| Surface | Actual source state |
|---|---|
| Shared card | `components/plans/PlanCard.tsx:129` defaults to `layout='title-first'`, complete creator row near joining, Share/Save at the title. Optional `{fonts}` at line101 already supplies cream/Mona/clay. `MyPlansView` uses it; the feed does not. Preserve this hierarchy. |
| Discovery list | `app/(tabs)/plans/index.tsx:977` and `:1013` render regular and duplicate-rail cards through `toPlanCardPlan`, without appearance. Header, section typography, filters, loading/error/empty states and featured carousel remain legacy. `FeaturedEventCard.tsx` has no appearance API. |
| Filters/map | `WhenCalendarSheet.tsx:26` and `FilterBottomSheet.tsx:40` have no appearance prop. Both use module-time window height and a lifetime PanResponder/animation callback; do not copy those dismissal assumptions into the new presentation without checking reopen/interrupted-close behavior. `WashedUpCalendar.tsx:36` already accepts appearance, but these callers do not pass it. `PlansMapView.tsx` remains a separate legacy surface, with platform-specific native-map compatibility fallbacks. |
| Detail and its sheets | `app/plan/[id].tsx` imports only legacy palette/type and passes no appearance to its shared calendar, BrandedAlert or SharePlanModal. Inline join/duplicate/ticket/manage/date/time forms, CirclePlanCoordination, MiniProfileCard and PingAfterPlanModal remain legacy here. The shared alert/share/calendar APIs exist; that does not mean this route is staged. |

## Discovery contracts to retain

- `lib/fetchPlans.ts:112`: `get_filtered_feed` is the eligible-list source. Only an explicit Near me tap supplies coordinates/radius. The initial radius is25mi; 5/10/25 presets remain. Feed queries use the existing 15s deadline, retry policy and60s stale window (`index.tsx:656`); do not restore the documented expensive refetch-on-every-focus behavior.
- Featured rows use `get_featured_eligible_ids`, then fetch only those IDs (`:742`). Preserve that eligibility gate. Featured plans stay out of normal sections and have their own end-time-aware filtering.
- `:342–409`: duplicate clusters sort by remaining capacity, keep one card per creator, collapse a one-card cluster, then interleave chronologically. `:864–935`: exact LA day and coarse date buckets are mutually exclusive; categories are multi-select; marked calendar days derive from the eligible non-featured rows. Map receives the original full eligible collection, not the list’s local category/day result.
- Membership is a separate nonblocking joined+created-ID read (`:836`); saved state is a wishlist, never membership. Card taps enter `/plan/{id}`; “Post your own” retains the existing duplicate-prefill destination. Only actual small-group plans belong in this discovery list; public Scene events are a different entity.

## Detail/join contracts to retain

- `app/plan/[id].tsx:302–402`: event details, permitted public creator fields, attendee reveal RPC with public-attendee fallback. Keep existing attendee visibility; profile permission is not inferred from a visual avatar.
- `:697–744`, `:835–921`, `:1960–2220`: creator, member, nonmember, ended, full, restricted, pending invite and waitlist-exception branches are distinct. Ordinary capacity is capped at8 total; featured capacity uses its own bounds. Circle members bypass ordinary capacity/age/gender gates; outsiders use the saved stranger-spot context. Do not replace those with one generic Join button.
- `:1088–1130`, `:2225–2298`: normal users/outsiders must write a nonempty greeting (max200), confirm “I’m coming”, and complete the existing participation assent when required. Circle members retain their explicit intro bypass. Joining uses `join_event_atomic` or `join_circle_plan_atomic`; event greeting messages are sent only where the Circle context says the plan has its own chat.
- `:2337–2395`: after joining, native-modal dismissal precedes sharing, then the existing Yours-enabled invitation step, then the ticket prompt or original plan-chat route. Joining a plan does not join its private Circle or parent community. Past members get Add photos only when a live non-archived album exists.
- Creator Manage, waitlist and cancellation controls, leave confirmation, official-featured limits,2000-character edit description,150-character creator message and LA/DST edit rules remain their own preserved paths.

## Concrete gaps before integration claims

1. **Repaired in this turn: Circle provenance was dropped by the real feed adapter.** `lib/fetchPlans.ts:59–65,145–184` carries `circle_id`, `circle_visibility`, `stranger_cap`, `circle_size`, `circle_in_count`; `lib/creatorMarks.ts:36–95` originally omitted them in both type and mapping. Both feed card paths use this adapter. After the audit, the parent authorized a narrow pass-through repair; the existing badge can now receive the supplied Circle fields. No query or eligible-list change was made. Distance/end-time omission is separate and is not part of that repair.
2. **Badge presence is not a completed capacity model.** `PlanCard.tsx:225–241,420–461` still derives full/waitlist/duplicate CTA from ordinary `max_invites/member_count` math even for Circle plans; it only suppresses ordinary scarcity and changes the footer copy. Detail body logistics also use ordinary counts (`[id].tsx:1800–1860`) while its joining gate uses stranger context (`:915`). The selected outsider cap is not remaining capacity. Preserve the individual creator and keep this explicit in the next Circle presentation/adapter pass.
3. **Detail identity/context has not received the newer scoped-read treatment.** `[id].tsx:510–550` loads account once; detail/member cache keys omit viewer, and `useCirclePlanContext.ts:28` keys a viewer-specific membership/spot result only by event. The latter also falls back to normal-plan context on a missing RPC; other errors are not surfaced by the caller. Before revising joining controls, add focused account/target/revisit tests and explicit unknown-context handling without changing admission policy.
4. **Several writes can report success after a returned Supabase error.** Feed wishlist mutation (`index.tsx:707–737`) does not inspect `{error}`, so its intended rollback can be skipped. Detail leave/cancel/waitlist and inline invitation updates (`[id].tsx:1135,1414,1474,2121`) likewise await responses without inspecting errors before UI/system-message changes. Fix each demonstrated receipt problem within its bounded package; do not treat a resolved request as confirmation.
5. **Error presentation is incomplete.** Detail loading has only a spinner and load failure offers only Back (`:1547–1574`); attendee query errors are not displayed. Feed auxiliary wishlist/member/featured reads convert failures to empty. Existing source-event cancellation reads (`[id].tsx:853–869`) also ignore query errors and can label a failed event lookup as cancellation. The next UI must distinguish unavailable/retry from an authoritative empty or cancelled state.

Circle deployment status is **not verified by this audit**. `docs/circle-plans-build-notes.md` contains historical June live-apply reports alongside earlier held-migration notes; current `GROUPS_ENABLED` defaults on unless explicitly overridden, despite older off-default comments. `CIRCLE-OPEN-PLAN-FRAMING.md` in the design folder captures the current accepted product direction and flags the capacity follow-up. Do not infer today’s deployed schema/policies from either old note. Local rendering can proceed with explicit fixtures; production preservation/join behavior requires its own authoritative baseline.

Existing relevant tests are `components/plans/__tests__/PlanCard.layout.test.tsx`, `lib/__tests__/planCardLayout.test.ts`, `lib/__tests__/planJoinSafety.test.ts`, `lib/__tests__/planTime.test.ts` and `app/plan/__tests__/plan-photo-edit.test.ts`. None proves full feed/detail integration. The next feed fixture must import the actual list/adapter and exercise standalone, duplicate rail, filters, featured and saved-state failure; detail tests must cover the actual join/member/creator branch before any release claim.


## Completed bounded adapter repair

`lib/creatorMarks.ts` now carries the five optional Circle fields from the existing `Plan` type into the card unchanged. The mapping preserves `null`, missing values and a real zero; it never invents public visibility or capacity. No distance/end-time addition, grouping, query, RPC, membership, source collection or native appearance changes were included.

The actual mapped card emits existing **Made from a circle** and **open to the feed** only for a supplied open Circle; **private to circle** only for supplied circle-only. Unknown visibility gets neither claim. With supplied `circle_in_count=2`, `circle_size=9`, `stranger_cap=4`, it emits **2 of 9 in** and **up to 4 others welcome**. The former is supplied Circle attendance versus Circle size; the latter is the configured outside cap, not four available spots. The ordinary full/member CTA behavior and individual creator/profile/plan destinations remain unchanged. Circle full/waitlist arithmetic remains the separate gap above.

Seven actual adapter→PlanCard cases were added to `components/plans/__tests__/PlanCard.layout.test.tsx`. Six failed against the original adapter while the ordinary-card preservation case passed. After the repair, **20 tests in 2 suites pass**:

```sh
npx jest --runInBand --ci components/plans/__tests__/PlanCard.layout.test.tsx lib/__tests__/planCardLayout.test.ts
npx tsc --noEmit --pretty false
git diff --check -- lib/creatorMarks.ts components/plans/__tests__/PlanCard.layout.test.tsx docs/plans-next-package-audit-2026-09-14.md
```

Full TypeScript and scoped diff checks passed. These render the real adapter and card with inert service/navigation mocks; they do not prove production feed visibility, server counts or physical-device layout. Schema reading used existing `Plan` fields, feed enrichment and saved `events_circle_shape`/DM-cap SQL. No migration was applied. The historical claim that the feed returns both Circle counts is preserved as optional source data; missing counts remain absent in the card rather than fabricated.
