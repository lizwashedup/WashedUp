> Later September 13 decision: Liz approved title-first as the shared PlanCard default, keeping the creator photo/name/profile row near join controls. The collection and interaction preservation below still applies; the historical creator-first composition is superseded. See [approved hierarchy](plan-card-hierarchy-2026-09-13.md).

# Yours → Plans: first native card port

The accepted direction is to keep the existing plan-card composition and light Plans surfaces, with the new typography, restrained corners and clearer controls. This package opts the existing `PlanCard` into that appearance from `MyPlansView`, behind the same local development switch as the rest of this isolated redesign. Discovery and every other caller keep their current appearance until their own integration pass.

## Source contract preserved

`components/yours/screens/MyPlansView.tsx` already contains Drafts, Upcoming, Saved, Interested, Waitlisted and Past. It uses `hooks/useMyPlansData.ts`; this port changes none of its queries, classification, count arithmetic, saved/unsaved operations, draft deletion or navigation. In particular:

- Upcoming merges joined and created plans, excludes explicitly left plans, and sorts by start time. The existing three-hour boundary is retained.
- Saved is a separate wishlist, including completed plans; saving does not join a plan.
- Interested and Waitlisted do not imply membership. Waitlisted and Past remain expandable; Past keeps the existing twenty-item display limit.
- Drafts reopen the same event draft through existing duplicate-prefill parameters. They do not become public through this port.
- The shared card still owns creator profile, share, save, report/block, exact plan navigation, full-plan waitlist and optional duplicate actions. The intro/join and capacity rules stay in their original destinations.

These source facts are not claims of backend correctness. The source currently converts several failed/timeout reads into empty collections and has distinct mutation-error handling gaps; explicit loading/error/uncertain-result work is still needed. Do not mistake an empty-state screenshot for proof that no plans exist.

## Appearance

The staged card keeps creator photo/name, title, category/privacy/featured badges, creator note, date/location and capacity/action footer in the same order. Actual profile-photo URIs remain untouched, as do the activity-first experiment and Circle variants. Mona-family tokens replace typography only when appearance is supplied; six-point card/button corners replace the rounded container treatment. Card shadow is quieter, action shadows are removed, and save/share/primary actions have 44-point targets. Footer actions may wrap as a group for narrow layouts or larger text. Existing semantic badge colors are retained pending their own review.

The default component still uses the previous fonts, dimensions, background and corners. Added button roles and bookmark selected-state labels improve semantics without changing callbacks.

## Verification boundary

Nine actual-component cases cover default versus staged text parity, creator-first versus activity-first composition, exact plan/creator destinations, bookmark callback arguments, share payload, and full/member/past states. Animations and transport are mocked for these tests; this does not establish physical-device performance or large-text fit. The browser fixture uses the actual `PlanCard` with local sample data and inert navigation/database adapters. It is a component review, not the complete Yours screen.

Remaining: full Yours header/collection states, populated connected prototype parity, source error handling, physical-device font scaling and scrolling, then discovery/detail/composer ports using the same card contract. Date/time entry still requires its own complete design and implementation review.

## Rendered component evidence

Actual React Native Web rendering was checked at 375 × 812 and 430 × 844. Share/save and primary/footer actions measured at least 44 points high; the 375-point page measured 375 points of content width, with no horizontal overflow. Long titles wrapped within the card and full-plan footer controls stayed readable. Saving changed only the local saved state; the existing primary action emitted the exact `/plan/sample-walk` destination. The test suite also asserts the share payload and creator navigation.

Screenshots are in the design workspace at `verification/native-plan-cards/`: `375-upcoming.png`, `375-full-and-past.png`, `430-upcoming.png`, and `430-full-and-past.png`. The local component review is `http://127.0.0.1:8845/?view=plan-cards`. Initials are sample fallback imagery, not a replacement for production profile photos.

One inherited presentation issue is recorded for the later card-state review: completed cards can still display the old remaining-capacity/urgency copy. This appearance-only port preserves it; it should be assessed alongside complete discovery/detail states rather than treated as an approved final completed-card design.
