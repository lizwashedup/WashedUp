# Event draft recovery — November 5

**Liz approved this upgrade on November 5. The backend is deployed and isolated live QA passed on project `upstjumasqblszevlgik`. The mobile changes are in private [PR 168](https://github.com/lizwashedup/WashedUp/pull/168).**

## Verified production outcome

The Supabase CLI applied the reviewed deployment from commit `64f574f` after all 95 live catalog entries matched the reviewed export. The installed definitions and grants matched all five expected routines. The receipt table has row-level security and only its owner has direct privileges.

The approved QA transaction created a draft under the existing leader’s authority, confirmed its free RSVP and capacity of 24, and recovered the same event when the original request was retried. Reusing a request with different details was rejected. Sealing an unsaved request prevented a delayed create. The test also verified account isolation and private receipt access. After rollback, the QA community was archived and hidden, with one active member, zero events and zero chats. The complete community and membership fingerprints and the fingerprint of all existing events matched their preflight values. The QA event and receipts were absent.

The App Review test account read capability version 1 and looked up a fresh request over the authenticated HTTPS API. Anonymous access was denied. The integrated iPhone 13 simulator also recovered the same pending request across real process restarts with simulated server responses. Live HTTP writes through the integrated phone UI remain a release check. All 427 integrated tests, 87 isolated PostgreSQL checks and the [full regression run](https://github.com/lizwashedup/WashedUp/actions/runs/42138892091) passed.

The private build from PR 168 subsequently passed the phone save/reopen check over loopback HTTP. On an iPhone SE simulator, a cold restart followed by You manage → the community → Events → Drafts recovered the original title, free RSVP choice and capacity of 24. In a second save, the local PostgREST server committed before the relay dropped the response. Check save → Open draft recovered the original 12-person draft with exactly one create request. The test used fictional accounts and a disposable PostgreSQL database. The production HTTP checks above cover authenticated reads. Evidence is in `/Users/liz/Desktop/WashedUp/Implementation/creator-draft-phone-http-20261105/result.json`.

The deployment, independent verification, rollback baseline and HTTP evidence are recorded in `/Users/liz/Desktop/WashedUp/Implementation/creator-daily-workflow-20261105/draft-live-rollout-result.json`. The original review and rollback instructions follow for reference.

## What changes for a creator

An interrupted first save can leave an event on the server even when the app receives no confirmation. Creating again can then duplicate it. Separately saving RSVP type and capacity can also leave only part of the intended draft saved.

The proposed path saves the draft and its settings together. The app stores the original request before sending it, and uses that same request if the creator retries. On returning to the form it checks the original save rather than automatically sending another write. The creator can open a confirmed draft or return to their original fields. Returning to editing first seals an unsaved request on the server so a delayed network request cannot create it later. It never deletes an already saved event.

This applies to **Save draft, Preview, first Add photos and first Add video** from the explicitly authorized legacy community/organization creation routes. It preserves existing approval and community-leader requirements. It does not add access for other team roles.

## Exact production proposal

Apply only `review-only/20261105_operator_event_draft_recovery.sql` to project `upstjumasqblszevlgik`, after Liz specifically approves it. It adds:

- A private `operator_event_draft_attempts` table holding the initiating account, immutable input and confirmed outcome. RLS is enabled; anonymous, authenticated and service-role clients have no direct table access.
- Four authenticated RPCs: capability, create, recover and seal an unsaved attempt. A fifth authorization helper is not client-callable.
- Account/request transaction locks and authority locks so concurrent retries, cancellation and grant revocation cannot silently create a second event.

The create RPC calls the existing writer and settings functions inside one transaction, with publication disabled. It changes no existing function, policy, record, membership or joining/discovery setting during deployment. Existing audience/owner checks still run. Saved receipts are historical: recovery does not overwrite subsequent edits to the event.

The deployment refuses unexpected writer/helper or event-trigger definitions, and refuses an existing receipt table. It has a three-second lock timeout and twenty-second statement timeout. Re-run the read-only catalog inspection immediately before deployment; do not remove a guard to force installation.

| File | SHA-256 |
| --- | --- |
| Deployment | `fae29fd990073a0d32de719d0c40d4b0e109114a43662e54ef93face229fdbf2` |
| Rollback | `ac0db970171df20e462d67b851b8ea2e3f38207e2a07ccb85d25e0459ae30ef9` |
| Transaction-only QA | `903bc414ed172cc164ff61a5a914de0099151e0e154117d4d0a765590d6c92be` |

## Verified locally

- **189 tests across five Jest suites** cover the protocol, account/visit ownership, timeouts and late results, immutable local persistence, confirmation-only cleanup, cancellation/retry races, restored fields and all four draft entry points. TypeScript and `git diff --check` pass.
- **87 isolated PostgreSQL 17 checks** replay the exported live writer/helper definitions and event constraints/triggers with fictional users. They cover complete settings, permissions, same/different-input concurrent retries, post-insert rollback, revoked access, existing women-only audience checks, cancelled and deleted attempts, exact endpoint permissions, drift refusal and data-preserving rollback.
- The exact proposed production QA SQL was rehearsed under the authenticated database role. It succeeds, rolls back its events and receipts, restores the archived/hidden QA community, and refuses a changed fixture.
- On the iPhone SE / iOS 26.4 simulator, the actual app router/form running fictional services recovered a saved event and reopened its free-event choice and capacity of 24. The unsaved path restored the original title, RSVP choice and capacity. Maximum-text testing found a text-measurement bug; recovery now uses the shared `ScaledText`, scrollable heading and separated actions. The recovery action worked through accessibility at Text Size 11; scrolling reached the bottom helper/action. Individual intermediate buttons were not all captured visually at that size. Text Size 3 was restored and only the QA app was closed.

Native evidence is under `/Users/liz/Desktop/WashedUp/Implementation/creator-daily-workflow-20261105/native`: `atomic-recovery-normal.png`, `atomic-recovery-max.png`, `atomic-save-recovered.png`, `atomic-save-reopened-ax.txt`, `atomic-return-to-editing-ax.txt`, and `atomic-return-to-editing-max-ax.txt`. The fixture exports JavaScript into an existing test binary; no native compilation or release occurred. Its storage is in-memory, so native cross-process durability is not certified; the AsyncStorage behavior is covered by the client tests.

The database fixture intentionally simplifies dependency tables and does not replay event visibility RLS policies. An unused creator-page-team helper is fictional. This is not full age/gender/Ghost, new creator-page or production transport certification. The existing production Ghost protocol is not modified by this proposal.

## Concrete deployment and isolated QA plan

1. Verify the hashes above, refresh `legacy-event-create-inspection-20261105.sql`, compare current dependencies and inspect the QA community's current status/authority and community status triggers. Stop on unexplained drift. Do not grant anyone new creator access.
2. Apply only the guarded deployment. Compare all five new routine definitions/ACLs with `supabase/tests/contracts/20261105_operator_event_draft_candidate_fingerprints.json`; verify table RLS and no direct client privileges. Existing events and community rules must remain unchanged.
3. Run `review-only/20261105_operator_event_draft_recovery.qa.sql`. It accepts only the known isolated **WashedUp Discovery QA** community (`ed31b9f3-2b78-4690-88b2-c05b74265a11`), archived and hidden, with its exact name/description, one active leader and existing approved creator authority. It temporarily activates that community inside an uncommitted transaction. It tests one draft, repeat/recover/seal behavior, account isolation and private receipt access under the authenticated database role. It verifies no event chat was created, then **rolls back all test writes**, including activation and receipts. No ordinary member receives an invitation, message or notification. Compare the complete QA community/member baseline after rollback as well as the final query's no-test-data result.
4. Check the capability/read RPCs through the authenticated API with an already authorized session to establish schema-cache/transport availability; do not print tokens. SQL role simulation is not a JWT transport test. If a refresh is necessary, use the normal PostgREST schema-cache notification and repeat the read-only check.
5. Record exact results. Live app save/reopen over HTTP and durable native restart remain release checks for the integrated client; deployment and transaction-only QA do not claim those are complete. Coordinate integration with the refactor task before any separate release request.

If the QA community is no longer isolated or the current authority does not pass, stop; do not change its memberships, permissions or other communities to make the test succeed.

## Rollback and remaining work

`review-only/20261105_operator_event_draft_recovery.rollback.sql` verifies the new function definitions and grants, then removes only the five new endpoints. It preserves every event and the private receipt table. Existing clients remain usable. A new client with a pending attempt will keep it blocked for recovery rather than silently use the old writer. Therefore rollback is data-preserving, but recovery stays unavailable until a reviewed forward repair restores the endpoints. Do not drop the retained table or rerun the original installation after rollback; it deliberately refuses that state.

Direct publish, first ticketed-setup creation, unscoped duplicate/template creation and existing-draft multi-write edits are outside this change. The broader creator experience and release regression work are also not declared complete. The local client detects only protocol version 1; a missing endpoint permits the old path only when no pending attempt exists. Network/permission failures and unknown versions do not trigger that fallback.

The other refactor task owns integration and wider release checks. `package.json` and `creator-review-entry.js` are preview-only and must not be included in this handoff.
