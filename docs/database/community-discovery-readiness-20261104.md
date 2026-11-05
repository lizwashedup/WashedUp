# Community visibility — verified app changes and proposed backend repair

**Subsequent status:** Liz approved this exact candidate, and it is now deployed with native creator QA and authenticated access checks complete. See [the production rollout record](direct-apply-evidence-20261104-community-discovery.md). The pre-deployment readiness record below is preserved; its not-deployed/approval-pending statements are superseded by that rollout. The updated UI remains local; no OTA or native build was published.

## What changes for creators

Community settings now exposes **Visibility & link** before publication as well as afterward. It names the selected community, distinguishes Draft, Published and Archived, explains discovery separately from joining eligibility, and offers sharing only for a confirmed published page. Publishing, unpublishing and archiving require confirmation and verified saved state. Settings no longer reports success from a zero-row write.

The app changes are local. **No OTA or native build has been published.** The November 3 joining upgrade remains deployed and unchanged. This record does not certify all creator flows or the new creator-page publication system.

## Production defect and proposed repair

Read-only inspection of project `upstjumasqblszevlgik` found that authenticated creators can SELECT `communities.discoverable` but cannot UPDATE that column. The old direct-update UI therefore could not save either discovery choice. There is no existing discovery setter. The current creator-authority definition matches the reviewed baseline.

The prepared, **not deployed** candidate is [20261104_community_discovery_control.sql](review-only/20261104_community_discovery_control.sql). It adds only:

- `get_community_visibility_options(uuid)`: a versioned capability check for the existing community leader/co-leader authority.
- `set_community_discoverable(uuid,text,boolean,boolean)`: checks the signed-in active leader/co-leader and the existing visibility-aware authority helper; locks community and membership rows; rejects stale status/visibility; updates only the selected community's discovery value; returns exact saved values.

The deployment itself does not rewrite communities, memberships, joining methods or audience restrictions. It does not grant direct column UPDATE or anonymous execution. Archived communities cannot be changed. The guard refuses deployment if creator authority or column privileges changed, or either new function already exists. The app disables discovery changes until the supported capability is available; permission, transport and malformed responses are not treated as missing support.

[The rollback](review-only/20261104_community_discovery_control.rollback.sql) checks both exact function hashes before removing only these two functions. It preserves records and any choices creators saved before rollback. It does not automatically undo those choices.

This is a separate production permission path from the previously approved joining migration. Apply it only after Liz approves this specific candidate, then run isolated authenticated QA. No app release is included in that approval.

## App safeguards

`lib/communityPublication.ts` centralizes lifecycle and discovery writes. It checks the selected active leader/co-leader, pins the initiating session header, bounds requests, rejects stale account/visit results, and serializes actions per account/community. Status changes still use existing RLS and publication triggers, with conditional before-state matching and exact returned values.

An immutable attempt is saved locally before dispatch. Unknown outcomes survive reopening; **Check status** is read-only, and **Retry change** repeats the original choice explicitly. A first dispatch explicitly rejected by the known database error contracts can be released for a fresh status check. A rejected retry does not dismiss an earlier unknown result. Lost/malformed/zero-row results are never reported as a successful save. This is client reconciliation, not a server transaction-receipt or comprehensive concurrent-editor guarantee.

`useCommunityPublication`, `CommunityPublicationFeedback`, the community settings screen and visibility screen share that behavior. Busy feedback identifies the operation; a status check no longer makes Publish and Archive both appear to be running. A returning visit cannot inherit a stuck sharing indicator.

## Actual native QA and cleanup

Device: iPhone 17 Pro Max simulator, iOS 26.4, actual Liz session, local Metro8872.

The real two-step form created **WashedUp Visibility QA**, ID `5c451c48-67ee-45c0-bf14-6c3a6606c201`, with Review requests. It had only Liz's leader membership. The first discovery attempt exposed the denied column update. Guarded SQL then checked the exact QA identity and sole creator before setting **only that draft** to `discoverable=false`. That fixture step is not evidence of a live discovery setter.

The app then reconciled the saved visibility read-only, published the hidden draft, showed Published with a share action, confirmed unpublish, returned to Draft without sharing, and archived the draft through its real confirmation. The archived screen removed discovery, share and unpublish controls. No ordinary member was invited or messaged. The share sheet/delivery itself was not exercised in this pass.

Final read-only SQL confirmed all six checks: QA archived/hidden; only its creator present; other communities' checked settings unchanged; creator-authority hash matching; candidate functions absent; direct discovery writes still denied. The fingerprint covers `id`, `status`, `discoverable`, `join_policy` of all other communities and matches `fd7c78b1eab8009ef4d2eff17d88da33`. It is not a claim that every production table was fingerprinted.

Normal Text Size 3 layout was inspected. At Text Size 7 the visible content wrapped without overlap, but bottom-action scrolling could not be verified with simulator automation. Text size was restored to 3 and keyboard capture remained off. The fixture stays archived and hidden; no records were permanently deleted.

## Validation and next deployment check

- **114 tests across eight targeted Jest suites passed**, covering publication, visibility UI, scoped recovery, joining settings, management routing and creator overview.
- TypeScript and `git diff --check` passed.
- Offline PostgreSQL 17 used fictional data, no network and no production credentials. Creator/co-leader authority, role/anonymous denial, exact receipts, null/stale/archived rejection, retained admission/audience, concurrent archive, concurrent role revocation, collision refusal, guarded rollback and authority-drift refusal passed. Runner: `scripts/db-contracts/test-community-discovery.cjs colima-washedup-release-test`.
- Canonical function MD5s after installation: getter `1953ffed81ba183d8f53ee5c7949abd9`; setter `0514f77cbc12424dedfa479cbc58a203`.

After approval: repeat live preflight, apply the unchanged guarded candidate in one transaction, verify function hashes/grants and unchanged community settings, then create a fresh isolated QA draft. Exercise both discovery choices in that unpublished draft, verify normal creator UI recovery, confirm non-creator denial using the authorized test account, and archive/hide the fixture. Keep existing community records untouched. Do not publish an OTA as part of this operation.

Remaining separate work: full community gender/age coverage, pending-request withdrawal, push delivery, released-app link/install/auth handoff, maximum-text scrolling, narrow/physical phones and Android. These checks are not closed by publication QA.

## Evidence

Machine-readable summary and file SHA-256s: [community-publication-qa-20261104.json](community-publication-qa-20261104.json).

Local evidence folder: `/Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02`.

- `native-community-visibility-published-2026-11-04.png`
- `native-community-visibility-large-2026-11-04.png`
- `community-visibility-cleanup-2026-11-04.txt` and matching query/screenshot
- `community-visibility-readiness-2026-11-04.sql`, `.txt` and `.png`
- `community-publication-tests-2026-11-04.log`
- `community-publication-typescript-2026-11-04.log`
- `community-discovery-postgres-2026-11-04.log`

Preview-only `package.json` main and `creator-review-entry.js` remain excluded from product commits and releases.
