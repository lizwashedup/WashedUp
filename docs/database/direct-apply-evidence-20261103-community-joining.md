# Community joining — approved production upgrade and isolated QA

Liz explicitly approved **“Apply the backend upgrade and run isolated QA.”** This authorizes the prepared joining migration and the bounded QA flow; it does not authorize an OTA or native build.

## Deployment

- Project: `upstjumasqblszevlgik`, `main PRODUCTION`.
- Applied source: commit `f316d70`, `docs/database/review-only/20261103_community_explicit_joining.sql`.
- Applied file SHA-256: `38d9efcb20c40419689f8ae383cb2fdd35de5a16c07200ba4714f427244cd616`.
- The signed-in Supabase SQL Editor executed the unchanged guarded file as one transaction and returned **Success. No rows returned**. This record supersedes the candidate's historical “not deployed” header; the reviewed source remains preserved verbatim.
- Fresh preflight verified all eight original function hashes, the enabled eligibility trigger, and the absence of the new capability and private tables. Existing community and membership state was fingerprinted before applying the upgrade.
- **22 independent post-deployment checks passed**, including twelve exact function hashes, private-table RLS and grants, RPC execution permissions, unchanged existing community/membership fingerprints, and preserved review behavior for all ten legacy communities whose stored value was Open.
- The prepared rollback was not applied. Existing admission eligibility functions and triggers were retained. No age/gender rules, plan restrictions or invitation-acceptance functions were changed.

## Live QA

The real local native app on iPhone 17 Pro Max / iOS 26.4 / Metro8872 created **WashedUp Joining QA** through the two-step form. Neither joining method was preselected; Create remained disabled until Review requests was selected. Creation succeeded, returned its verified receipt, and View community opened the correct management workspace.

The new community initially remained a draft. A guarded SQL fixture operation checked its exact identity, sole creator membership, and absence of a creator-page draft/publication, then made only that QA community active with `discoverable=false`. This allowed the legacy admission path to be exercised without publishing a page or inviting ordinary members. The temporary active status is fixture setup, not evidence that the app's publication flow was tested.

- Community: `b016eee2-83e4-427c-916c-58b6a7eae4f0`.
- Creator: Liz, `ae8006dc-5bca-42b8-975a-e11ad14b796f`.
- Recipient: documented App Review account, `34900c70-6339-40c5-b294-6b0a01310175`.
- Creation request: `b4ddbc8d-823d-46c2-9c15-455cf95b1d59`.
- Recipient membership throughout the roundtrip: `39872eb8-7ef8-40cb-9151-6e677899e4ef`.

The recipient authenticated through the real Supabase SDK using the documented permanent App Review test login. Its verified account ID was checked before every operation. Tokens were kept in process memory, never logged or exported; Liz's native session was not changed. **Recipient joins were API tests, not a recipient-device walkthrough.**

1. Under Review requests, the recipient's first join created one pending member record.
2. The non-creator could not change the community's joining method.
3. In the native creator settings, Open showed a confirmation that one request was waiting and would still need review. After confirmation, the effective method was Open while the request remained pending. Retrying that pending request was rejected and did not activate it.
4. The creator approved App Review through Members. The recipient became active. Calling `leave_community` while pending had previously returned without changing that request; this was not treated as successful withdrawal. Normal departure after approval correctly changed the member to left.
5. Rejoining under Open activated the same membership immediately. A duplicate active join was rejected.
6. The creator switched back to Review requests through Settings. The already active member stayed active, then left through the normal departure RPC.
7. The creator edited the QA introduction question and saved through the native joining editor. The app confirmed Saved, and SQL independently verified the exact text.
8. Authenticated access checks confirmed that another account receives no creator receipt, both private tables reject direct access, and the capability rejects anonymous execution.

The creator archived the QA community through its actual Settings action. **All 13 final checks passed:** archived/hidden fixture, request-review method, recipient left, creator role retained, only the two approved accounts, one receipt, one set of five starter blocks, saved form edit, no publication, no duplicate membership, unchanged non-test community and membership fingerprints, and all ten original legacy Open communities still requiring review. No test records were permanently deleted; receipt, membership and normal QA activity history remain. No ordinary members were invited or messaged.

## Local UI correction found during QA

The creator overview could retain a cached member count after a departure on another session. `app/(creator)/today.tsx` now refreshes its existing member query when that screen regains focus, after creator access is available. The native overview updated from the stale two members to the independently verified one member. The two overview suites passed **17 tests**; TypeScript and diff checks passed. The earlier **151 joining tests** remain applicable. This correction is local and is not an OTA.

## Evidence and remaining limits

Machine-readable release record: `docs/database/community-explicit-joining-production-20261103.json`.

Actual queries, exported results and screenshot are saved under `/Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/`:

- `community-joining-production-queries-and-results-2026-11-03.json`
- `community-joining-production-cleanup-2026-11-03.jpg`
- `explicit-joining-authenticated-qa.cjs` (bounded real SDK test runner; no stored tokens)

This verifies the deployed legacy joining contract, creator setup/settings/approval/archive routes and authenticated recipient backend behavior. It does not certify full production gender/age coverage, push delivery, publication, released-app link handoff, newcomer install/auth return, recipient-device UX, maximum accessibility scrolling, narrow/physical phones or Android. The known development-client keychain registration warning remains a separate push/device limitation. No app build or OTA was published.
