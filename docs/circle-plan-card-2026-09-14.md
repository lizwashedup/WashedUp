# Circle Plan cards — September 14, 2026

## Result
Public Circle plans now use one Friends group badge and the explanation “A plan with an existing group of friends.” The individual poster remains visible with the same profile destination. Share/Save remain alongside the title. Circle-only rows say Circle only; unknown visibility does not invent public status.

Feed outsider spots_remaining survives fetchPlans and the shared card mapper independently of corrected total attendance. Cards preserve the stored stranger_cap, including six for the existing two-person DM exception and up to seven for Circles. Invalid, missing or contradictory outside availability opens details with Check availability. No Circle card offers ordinary Waitlist/Post your own. Positive known availability retains the original detail destination; existing attendees see View plan. No joining rules, writes or RPCs were added.

The Plans section now uses the shared card mapper. Joined/created, saved, waitlisted and interested collection fetches retain source Circle provenance through existing feature-gated event reads. These reads do not return outside availability, so personal cards defer it to details instead of deriving it from total attendance. Existing collection eligibility, left-membership exclusion and sorting remain.

## Evidence
- 49 tests in three suites: actual PlanCard/mapper, actual feed/interested fetch pipeline, personal collection queries/mapping. Covers total attendance above ordinary capacity while outside places remain, no outside places with low attendance, missing/malformed counts and provenance, private/unknown context, existing attendee action, creator destination, sharing/saving and feature-off query parity.
- Native TypeScript and plans-feed fixture TypeScript pass; local Metro preview rebuild passes.
- 43 resolved feed provider bindings plus 29 inherited provider checks pass. The real screen, shared card, mapper and capacity helper are bundled; provider actions resolve to fictional adapters.
- Browser: 375-point large group shows two open places and opens /plan/sample-circle; 320-point unknown availability keeps View plan on one line and saves the exact fictional plan; 430-point full Circle shows No open spots / View plan without ordinary waitlist or duplicate actions. Screenshots retained here.
- Scoped whitespace checks pass. Existing larger card redesign changes predate this package and were preserved.

## Limits and next action
Browser data is fictional and navigation stops at a local destination observer. These checks do not prove real feed eligibility, server joins, membership races, deliveries, native touch/keyboard, accessibility text scaling or production schema deployment. The private preview injects a row only to test presentation, not public exposure. Availability is a feed snapshot; actual joining still requires current detail/admission checks. Personal collection availability remains deliberately unknown until details load. Existing cancelled/completed-card urgency and action treatment needs the next bounded lifecycle package; creator/organization/supporting screens and native/backend release verification remain. The whole-app goal stays active. No production or original-checkout changes.
