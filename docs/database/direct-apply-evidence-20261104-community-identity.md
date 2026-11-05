# Community identity permission — live rollout, November 4, 2026

## Authorization and deployment

Liz explicitly answered **“Apply the repair and run isolated QA”** to the request to enable short-description saving under existing community access rules, verify saving/reopening in the existing isolated QA community and restore its details. No OTA was included.

Applied the exact reviewed file from commit `932b3ce` to Supabase project `upstjumasqblszevlgik`, main PRODUCTION, using the existing signed-in SQL Editor:

- Source: `docs/database/review-only/20261104_community_identity_permission.sql`.
- SHA-256: `ce688349eb7a752b4abf30b585ed97b8327b4435e23dee200662d433207ca503`.
- Mutation: `GRANT UPDATE(purpose) ON public.communities TO authenticated`.
- The embedded RLS/policy/helper/permission/constraint guards passed. Dashboard reported **Success. No rows returned**.
- The reviewed rollback is retained and was not applied. The candidate's historical “not deployed” header is retained to preserve its approved hash; this record supersedes that status.

## Independent verification

Read-only state queries were exported before deployment, immediately afterward and after native QA. All **12 deployment checks passed**: all community records, other-community records, membership records, counts, RLS/table privileges, policy fingerprint, checked community/creator-page routine fingerprint and QA state unchanged; authenticated purpose permission present; anonymous purpose permission absent; only the purpose column ACL changed.

Fresh baseline was **13 communities and 95 memberships**. This is a new baseline, not the earlier discovery rollout's membership count. After native QA, all **nine final checks passed**. All 12 other community records and all 95 membership records still match the preflight. The QA record's original name, purpose, status, discovery choice, joining policy and all other fields except its expected `updated_at` change are restored. Community count remains 13. No policies/functions were changed by the repair.

Useful fingerprints:

- Community policies: `422a4716b340e3fb9b758f6c34bfbb15`.
- Checked community/creator-page routines: `aeed0250f6643bda42d8e6d642b6e15c`.
- All other communities: `ddb04567bf6f9798151e405a7c3ed689`.
- All memberships: `a9f0a4bb0658fcabab3649b15dc7057a`.

## Authenticated and native QA

The documented App Review account was authenticated through the real SDK and verified as `34900c70-6339-40c5-b294-6b0a01310175` before testing. All **three access checks passed** against only the isolated QA community: non-member combined name/purpose update denied, non-member purpose-only update denied, and anonymous purpose update denied. The non-member requests returned zero updated rows under RLS; anonymous access returned `42501`. No session credentials were exported. No membership, ordinary invitation or message was created.

On the actual signed-in creator session, iPhone 17 Pro Max / iOS 26.4 / Metro8872:

1. Opened archived **WashedUp Discovery QA** → Settings → Edit community → Basics.
2. Saved `WashedUp Discovery QA Verified` and `Private isolated QA: community name and description save verification.` through the app. **Saved** appeared only after the exact receipt.
3. Left the entire editor. Settings and the editor overview reflected the new name. Reopened Basics; both saved values persisted.
4. Restored the original name and purpose through the same native Save action. **Saved** appeared. Reopened and confirmed both original fields again.
5. Returned to Community settings. Text Size 3 and Capture Keyboard off were retained. The shared simulator record was released; other devices and Metro servers were untouched.

Final fixture: `ed31b9f3-2b78-4690-88b2-c05b74265a11`, **WashedUp Discovery QA**, purpose **Private isolated QA of discovery controls. No ordinary members or invitations.**, archived, hidden, approval required. Membership state is unchanged.

The walkthrough also caught an inaccurate **not started** Basics summary after a successful identity save. Its local replacement, **Add a cover photo and an introduction.**, describes the missing page blocks without claiming the saved identity is absent. The actual native overview showed the replacement. The affected editor suite passed **13 tests**, and `git diff --check` passed. This small copy edit is local, not an OTA.

## Evidence and limits

Evidence directory: `/Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02`.

- `community-identity-baseline-2026-11-04.json`, `community-identity-after-deploy-2026-11-04.json`, `community-identity-final-2026-11-04.json`.
- `community-identity-deployment-checks-2026-11-04.json`, `community-identity-final-checks-2026-11-04.json`.
- `community-identity-live-access-2026-11-04.cjs` and `.json` — bounded isolated SDK checks and results; no stored credentials.
- `community-identity-deployed-2026-11-04.png` — actual SQL success.
- `native-community-identity-saved-2026-11-04.png`, `native-community-identity-reopened-2026-11-04.png`, `native-community-identity-restored-2026-11-04.png` — actual app state.

The earlier 54 app tests, TypeScript pass and 28 isolated PostgreSQL checks cover the prepared implementation. This rollout adds real backend/native evidence for identity saving. It does not certify the entire block editor, physical iPhone, Android, released invitation handoff, push delivery or all legacy age/gender/Ghost behavior. Those earlier limits remain. **The backend repair is live; no OTA or native build was published.** Preview-only package/entry changes remain excluded from product commits.
