# Plan inbox lifecycle alignment

September 12, isolated candidate. No database or live app changes.

The thread already used the accepted end-first expiry helper, but both inbox passes and the countdown still calculated 48 hours from the start. A multi-day plan could therefore move into Past while its event was still happening.

`useChatList` now includes the existing `events.end_time` column in its membership read and retains it on event previews. First paint and the fully enriched result use the same helper: a valid end later than the start plus 48 hours, otherwise start plus 48 hours. Cancelled plans stay in Past. Circle/DM persistence and the two-member eligibility gate are unchanged.

The countdown uses that same expiry and rounds a remaining partial hour upward instead of dropping the label during the final half-hour. It uses singular “hour” when appropriate. These changes do not delete messages or alter membership.

Seven focused tests pass across the lifecycle helper and an actual mocked `useChatList` render. The hook test delays message enrichment to check both first paint and final rows against ongoing multi-day, exact-expiry, cancelled and missing-end fixtures. All retain the same eligibility and end-time data.

Existing held server policy/expiry migrations and device checks still need to be validated together before release. A correct inbox label does not prove deployed RLS, cron or notification behavior. Other known legacy inbox issues, including limited bulk preview queries and account-cache races, are separate work items.
