# Joined plan cards — September 14, 2026

Active ordinary and Circle PlanCards now show Going ✓ for established membership, matching the existing Featured action. The footer shows total attendance rather than remaining public places. Membership suppresses scarcity animation, waitlist and duplicate-plan promotion. Closed states retain precedence and View plan. Actions retain the original plan detail route; no automatic chat navigation or admission writes were added. Card accessibility labels now include going/closed state for both standard and Featured cards.

The feed membership read now excludes explicit departures from joined/created IDs, matching Yours. A failed joined/created/departure read rejects rather than manufacturing participation. Existing user-scoped query, timeout, join/leave invalidations and detail admission checks remain. This is not server concurrency or durable membership verification; cached data retains the existing refresh policy.

Validation: 67 tests in four suites pass (PlanCard layout/state, Featured state/destination, Yours lifecycle and new feed membership read). Native TypeScript passes. Tests cover joined full/non-full cards, suppression of admission prompts, same destination, mounted join/leave transitions, Circle and closed-state precedence, explicit creator departure and each failed membership read. Local native Plans rendering was visually checked with fictional joined coffee/unjoined walk fixtures.

Source: components/plans/PlanCard.tsx, components/plans/FeaturedEventCard.tsx, app/(tabs)/plans/index.tsx, lib/feedMembership.ts and their targeted tests. Temporary fixture correction: pending survey RPC returns null rather than an empty array, matching the actual no-survey contract. No original checkout, provider or production changes.

Remaining: consistent headers and spacing across main tabs; Scene visual port; hidden-route tab accessibility counts; creator/auxiliary screens; real service/device integration. Whole-app goal remains active and incomplete.
