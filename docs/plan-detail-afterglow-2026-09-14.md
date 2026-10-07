# Plan detail and joining — isolated Afterglow implementation

The goal is a warm, clear place to find people to do things with. This package makes the activity and practical decision lead, keeps the actual person visible, and makes joining outcomes truthful. It extends the selected cream/ink/clay and Mona appearance through the existing Plan detail route. The shared navigation and legacy appearance remain available.

## Presentation

`PlanDetailOverview` places the title above date, place, availability and the full creator row. Share and Save stay in the header. The creator’s note uses the existing decorative gold rule; photos retain their color and use monograms on failure. Optional tickets explicitly remain separate from joining. Attendees have photo-left rows, with a handle only when the permitted response actually supplies one. The saved public-profile view deliberately omits handles; no enrichment or invented identity was added.

`PlanJoinSheet` retains the required introduction, 200-character limit and existing “I’m coming” check. Its contents scroll above a fixed 48-point action. Pending work disables repeated submission and editing. Definite rejection retains the introduction; an unknown membership result offers Check plan without automatically joining or sending again.

## Preserved rules and demonstrated repairs

Ordinary plans retain existing total-capacity, age/gender, waitlist and introduction requirements. Circle context now requires a current account and trustworthy event provenance. Missing or malformed context cannot select ordinary joining. Circle attendance uses actual people going, while public availability uses the existing outsider cap; Circle members retain their eligibility and capacity bypass. Private outsiders receive no join action. A full public Circle does not promise ordinary waitlist notifications: the saved ordinary waitlist counts total attendees, which is a different server contract.

The existing Circle conversation is used when `has_own_chat` is false, including after joining and while context refreshes. Public/subset Circle plans retain their own plan conversation. The last confirmed conversation choice is retained only inside the keyed account/plan session.

`usePlanJoin` validates literal server receipts, owns pending/confirmed/unknown attempts by account and plan, and rejects obsolete callbacks. Confirmed membership remains confirmed when an optional system or introduction message fails. An unconfirmed introduction is retained in a selectable, scrollable recovery alert; normal sharing is skipped. Open chat belongs to that exact recovery and active visit and can run once. Cached detail stays mounted if its background refresh fails, keeping recovery available while an explicit refresh notice blocks a new join.

Waitlist exception acceptance/decline now belong to the initiating account, plan, notice and visit. Existing VOID RPC semantics, legal copy, notification filters and event-chat destination are preserved. Normal assent likewise requires the initiating account and exact current notice. Native sibling sheets are sequenced by dismissal rather than assumed complete from a visibility update; physical iOS behavior still needs device verification.

Save uses the established receipt-aware wishlist controller. Detail/member reads and auxiliary album/source-event reads include account generation. A missing source event is no longer claimed to be cancelled. Late geocoding cannot replace newer coordinates.

## Scope and remaining work

This package covers overview, joining, Circle admission context, confirmed-join recovery and exception operation ownership. Existing creator edit/cancel, leave, ordinary waitlist, ordinary invitation and some auxiliary actions still require their own receipt/lifetime and presentation pass. Their presence on the route is not a completion claim. Circle card/composer capacity consistency, server-side idempotency and Circle-aware waitlist behavior remain separate work.

Everything is local to the isolated checkout and fictional review services. No SQL, deployment, real membership, message, assent, invitation, account or provider action occurred. Browser tests use React Native Web, not an actual iOS navigation stack, backend RLS or real delivery. Final targeted counts, source fingerprints and screenshots are recorded in the design folder’s `verification/plan-detail/VERIFICATION.md`.
