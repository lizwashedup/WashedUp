# Community discovery — approved production repair and isolated QA

Liz approved **“Apply discovery fix and run isolated QA.”** The prepared discovery repair is deployed and verified. This authorization does not include an OTA or native build; the updated creator screens remain local.

## Deployment

- Supabase project: `upstjumasqblszevlgik`, `main PRODUCTION`.
- Applied source: `c4e48d7`, `docs/database/review-only/20261104_community_discovery_control.sql`.
- Applied SHA-256: `dbc56ee32d23f31d064310ad4a956d5bdfa61633e8f13c7ba5239ad389c3ad23`.
- The signed-in SQL Editor executed the exact approved file in one guarded transaction and returned **Success. No rows returned**. The source file retains its historical review-only header; this deployment record supersedes that status.
- Fresh preflight confirmed matching creator authority, absent new functions, denied direct column writes, and fingerprints of every existing community and membership row.
- All **11 post-deployment checks passed**: exact function definitions, authenticated execution, anonymous denial, unchanged direct-column privileges, unchanged creator authority, unchanged joining routines, and all 12 existing communities / 93 memberships unchanged.

Canonical installed function MD5s are `1953ffed81ba183d8f53ee5c7949abd9` for the capability and `0514f77cbc12424dedfa479cbc58a203` for the setter. The guarded rollback remains available and was not applied. No existing joining, audience, publication, invitation or plan rule was changed.

## Live authenticated QA

The actual Liz session in the iPhone 17 Pro Max simulator, iOS 26.4 / Metro8872, created **WashedUp Discovery QA** with Review requests through the two-step form.

- Community ID: `ed31b9f3-2b78-4690-88b2-c05b74265a11`.
- Creator: `ae8006dc-5bca-42b8-975a-e11ad14b796f`.
- Handle: `washedup-discovery-qa`.

The creator opened Settings → Visibility & link. The newly supported controls were available without a flag change. **Link only → Show in discovery → Link only** each returned Saved through the real client/RPC path. Independent SQL verified both false and true discovery values while status stayed `draft` and joining stayed `approval_required`. Leaving and reopening the screen retained Link only. The fixture was never published and did not appear publicly as a result of this test.

The documented App Review account (`34900c70-6339-40c5-b294-6b0a01310175`) authenticated through the real SDK for permission tests. Its identity was verified before testing. All **five access checks passed**: non-creator capability and setter denied, direct discovery UPDATE denied, anonymous capability and setter denied. These were SDK checks, not a second-phone walkthrough. The account did not join the community, and no ordinary invitations or messages were sent. Credentials and session tokens were not exported.

The creator then archived the hidden draft in the native app. All **eight cleanup checks passed**: exact archived/hidden fixture with Review requests; sole active creator membership; all 12 pre-existing communities unchanged; all 93 pre-existing memberships unchanged; joining routines unchanged; exact discovery functions installed; anonymous access denied; direct-column writes still denied. No records were permanently deleted.

Baseline and final fingerprints of the pre-existing complete rows:

| Scope | Matching MD5 |
| --- | --- |
| 12 community rows | `ddb04567bf6f9798151e405a7c3ed689` |
| 93 membership rows | `090d3dbc4b577e30cf8df7e329ebe80c` |
| Inspected joining routines | `8326f005a8280ba90c512d85f7109bae` |

## Local copy correction and limitations

Reopening an earlier confirmed creation showed a saved receipt even after its community had been archived. Receipt recovery was correct, but the success screen incorrectly claimed the page was still a private draft. It now says the community is saved and directs the creator to its current status. The selected discovery label now remains **Show in discovery ✓**, including on unpublished drafts. These are local copy changes; no backend behavior changed after the reviewed deployment.

The two affected screen suites passed **17 tests**, TypeScript and diff checks passed. The preceding **114 targeted tests** and isolated PostgreSQL verification remain recorded in the readiness report; these counts overlap and should not be added together.

A pre-existing simulator development warning showed `TypeError: Network request failed` from Supabase Auth's `_handleRequest` handler (`@supabase/auth-js/dist/main/lib/fetch.js:104`). The SDK classifies that branch as `AuthRetryableFetchError`; all tested authenticated operations subsequently completed. No network-error suppression or authentication code change was made. This pass does not establish the cause of the transient failure or certify offline/resume recovery.

The simulator was returned to the grouped You manage directory, Text Size 3 and Capture Keyboard off. Physical/narrow phones, Android, maximum accessibility scrolling, push, released-app links and full community age/gender coverage remain separate checks. Pending-request withdrawal is still open. The installed app needs the updated local UI in a separately authorized release to use the new setter; **backend deployment alone does not replace the old client code**.

## Evidence

Machine-readable record: [community-discovery-production-20261104.json](community-discovery-production-20261104.json).

Local artifacts under `/Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02`:

- `community-discovery-production-evidence-2026-11-04.json` — actual preflight, apply, post-check and QA query/UI observations.
- `community-discovery-production-cleanup-2026-11-04.png` — final production verification.
- `native-community-discovery-verified-2026-11-04.png` — actual local native controls after reopening.
- `discovery-authenticated-qa.cjs` and `discovery-authenticated-qa-2026-11-04.log` — bounded permission tests using the authorized test account.
- `community-discovery-rollout-jest-2026-11-04.log` and `community-discovery-rollout-typescript-2026-11-04.log` — final local checks.
