# Current post-plan invitation repair

September 12, isolated implementation. This repairs the current PlanComposerV2 posting path, separately from the previously repaired legacy post-join invitation overlay. No real invitations, plans or notifications were sent during verification.

## Result

The confirmation screen now distinguishes saving the plan, sending its invitation request, a confirmed request and an uncertain result. It no longer says recipients were notified before the request finishes. A confirmed request means the existing batch RPC returned successfully; it does not prove delivery to each person or a displayed push.

The original recipient IDs and saved plan ID survive form reset so an explicit retry uses the same plan and same selected people. Retries cannot create another plan or member row. Rapid taps, old callbacks and account changes cannot start overlapping requests or overwrite a newer result. Exits stay disabled until the plan is acknowledged and the active invitation request settles; an uncertain invitation result allows continuing to the saved plan.

The people picker uses the current observed account, retries read failures, and counts only selected people who remain pickable. Opening a new account's picker cannot inherit the previous account's selection or pending retry. Empty states appear only after a successful people read. The underlying accepted-people query, suggestion ranking and invitation batch RPC remain unchanged.

A missing saved plan ID enters the existing recovery path. Failure to save the local first-plan celebration preference cannot undo the success UI or encourage a duplicate post after the plan and membership have already committed.

## Verification

Four focused suites passed **28 tests**: invitation request controller, people picker, confirmation states and the rendered composer with a mocked backend. They cover failures/retries, account generations, late results, no-recipient pending inserts, missing IDs, local preference failure and no second plan/member insert on invitation retry. Full noEmit TypeScript and scoped diff checks passed. Tests use mocks; they do not establish production RPC or OneSignal behavior.

The real confirmation component and invitation controller were also exercised in a local React Native Web harness with mocked transport. At 375 × 812, the dialog fits the viewport; Retry is 44 points high and exit buttons exceed 51 points. The visible sequence was Posting → invitation failure with Retry → Sending with exits disabled → request confirmed → return to the saved-plan destination. This checks local interaction and layout, not iOS/Android gestures or real delivery.

## Boundaries and next work

Plan validation, fees, eligibility, admission and date/time changes already in the isolated copy were preserved. The plan/member insert sequence and existing batch recipient policy were retained. Private contact data was not exported.

The confirmation's broader visual redesign remains part of the staged posting package. Real devices, interrupted networking, actual push destinations and server deduplication still need release validation. Continue to report the request outcome honestly rather than treating a successful client mutation as proof every device displayed an alert.
