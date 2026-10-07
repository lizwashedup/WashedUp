# Plan-card lifecycle — September 14, 2026

## Result
The actual shared PlanCard and FeaturedEventCard use the same lifecycle rules as details. Explicit end times take precedence; otherwise the existing start-plus-three-hour rule remains. Authoritative Cancelled/Completed statuses close future-dated cards too. An elapsed time alone says Ended, never inventing completion.

Closed cards retain their original View plan destination, creator identity, share/save and existing history access. They stop showing current-place counts, Circle outside availability, happening-now, ordinary waitlist and Post your own prompts. Optional redesigned cards remain full contrast rather than fading all content. Cancelled plans do not show a Going confirmation.

Status/end_time now pass through the shared mapper; personal joined/created, saved, waitlisted and interested event reads preserve end_time. Yours uses the same lifecycle rule for Upcoming/Past, preserving sorting, the 20-item Past limit, collapse behavior and collection eligibility (including existing cancelled-row exclusions in personal queries). No new archive collection was introduced.

A local clock schedules the next start/cutoff and refreshes on AppState active. It cleans up timers/listeners, handles changed dates and avoids long-timer overflow. It performs no network reads. Mounted cards close at the cutoff without a parent refresh; Yours moves a visible plan into Past. Fresh backend status changes still arrive through existing queries, not a new subscription.

## Verification
- 111 tests across 8 suites pass: actual standard/Featured cards and shared adapter; lifecycle/time boundary rules; actual personal collection queries; actual MyPlansView section transitions; clock background/cleanup/date-change/timer-limit behavior; inherited Circle availability/source tests.
- Native TypeScript and the expanded plan-cards/feed fixture TypeScript pass. Local Metro build passes.
- 48 feed/card/lifecycle/clock provider bindings plus 29 inherited checks pass. Actual components/helpers remain; provider operations resolve to fictional adapters.
- Browser: cancelled standard card at 320, live-to-ended transition at 375 without reload, cancelled Featured card at 430. The cancelled card opens /plan/sample-history. Status is readable and View plan stays on one line. Evidence screenshots are retained here.
- Scoped whitespace checks pass. Prior card-design work was preserved.

## Limits
Fictional samples and component tests do not establish native AppState behavior, device text scaling, real navigation/history retrieval, multi-client cancellation delivery or server admission. Time transitions use device time; actual admission still requires server checks. Existing discovery refresh/filtering and personal collection membership rules were preserved. The preview’s timing case ends 12 seconds after opening; default review is an ordinary still-current long-duration example. No production data, messages, invites, original checkout, feature deployment or release changed.

## Next
Creator event summary is the next source-backed design package: app/creator/event-summary.tsx has the real edit/tickets/check-in/attendees/money/message destinations but no optional Afterglow presentation; attendee reads default to an empty list without an explicit error state. Inspect event ownership/access, failure/empty/loading distinctions and existing flags, then port the hub and verify all destinations locally. Do not execute ticketing, payouts, check-in, invitation or messaging writes. Broader creator/organization/supporting screens and native/backend/history/notification verification remain. The whole-app goal is active and incomplete.
