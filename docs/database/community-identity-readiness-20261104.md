# Community name and description saving — November 4

**Prepared and tested locally; not deployed. Separate production approval is required. No OTA or native build is included.**

## Confirmed problem

Native testing on iPhone 17 Pro Max / iOS 26.4 / Metro8872 tried to change only the name of the isolated **WashedUp Discovery QA** community. The form submits name and short description together. Supabase rejected that combined update with `42501: permission denied for table communities`. The new client receipt handling correctly retained the draft and did not show Saved.

Read-only inspection of project `upstjumasqblszevlgik` confirmed that `authenticated` already has column UPDATE on `name`, but has **no UPDATE on `purpose`**, the short-description field. It has no table-wide UPDATE privilege. The purpose column was added by the August 20 migration without adding the required column grant. Existing community RLS limits ordinary identity edits to active leaders and co-leaders, with the existing visibility check; platform administrator exemptions already exist in that policy.

The failed test made no identity change. Its input was restored to the original name before leaving the editor. Independent database inspection confirmed:

- ID `ed31b9f3-2b78-4690-88b2-c05b74265a11`.
- Name `WashedUp Discovery QA`.
- Purpose `Private isolated QA of discovery controls. No ordinary members or invitations.`
- Archived, hidden, approval required, one active member.

Evidence: `/Users/liz/Desktop/WashedUp/Design/Creator management review 2026-11-02/native-community-identity-permission-denied-2026-11-04.png` and `community-identity-live-contracts-2026-11-04.csv` in the same directory. The read-only inspection SQL and parsed catalog export are checked in. Existing browser sign-in remained valid; native Chrome UI was used after extension calls timed out.

## Exact proposed production change

`review-only/20261104_community_identity_permission.sql` adds only:

```sql
GRANT UPDATE(purpose) ON public.communities TO authenticated;
```

The script checks the exact four-policy fingerprint, RLS enabled, current leader and visibility helper definitions, current column permissions and description validation before granting. It refuses unexpected state or duplicate deployment. It uses a bounded transaction with a short table lock. It changes no records, policies, functions, membership, admission, discovery settings or publication state. It grants no anonymous purpose permission. PostgreSQL still applies the existing row-level policy to each edit.

- Deployment SHA-256: `ce688349eb7a752b4abf30b585ed97b8327b4435e23dee200662d433207ca503`.
- Rollback: `review-only/20261104_community_identity_permission.rollback.sql`.
- Rollback SHA-256: `9e27bf1da2025735871b05cfcdef36381cd937f502dcd6599a06a8bca71f03bb`.
- Rollback revokes only the added column permission, refuses changed grants and keeps saved content. Existing name permissions remain.

This is separate from the already approved and deployed joining and discovery changes. Liz's approval for those changes does not implicitly deploy this permission correction.

## Local verification

`scripts/db-contracts/test-community-identity.cjs colima-washedup-release-test` passed **28 checks** in PostgreSQL 17 with networking disabled and fictional users/communities. The test replays all exported community RLS policies, the actual leader/member/visibility functions, name/purpose constraints and updated-at trigger. It reproduces the failed combined save before the grant and then verifies exact returned values for leaders/co-leaders; denial for community admin, events, member-care, finance, members, outsiders, revoked co-leaders, anonymous and missing-user sessions; unchanged discovery denial and length validation; existing archived access; publication visibility; no deployment row changes; only the intended ACL change; duplicate/drift refusal and data-preserving rollback.

Audience matching is a fictional dependency in this fixture. This preserves and exercises the visibility hook; it is **not** full production age/gender/Ghost certification. It also does not add a concurrent-edit or durable transaction-receipt protocol to ordinary identity editing.

The app requires an exact saved name/purpose receipt, pins the initiating session and community, prevents same-frame duplicate saves, ignores retired account/visit results, and retains edits on errors. The new permission error is expressed in user-facing language. Community admins keep existing page-section access but no longer see identity Save or leader-only joining/discovery/publication controls. Help shows actual roles and application states, with distinct failed-read/retry states. The local client remains unreleased.

## Next action after specific approval

1. Rerun the read-only preflight and verify the candidate hash. Apply only this reviewed file as the existing database owner.
2. Confirm the single added grant, unchanged policies/helpers and ordinary records.
3. Use the existing isolated archived QA community: native leader save, leave/reopen, verify exact returned and persisted name/description, then restore the baseline name/purpose. Keep archived, hidden, approval required and the same sole active member.
4. Use the already authorized App Review test account for a rejected update against that QA community; verify no row changes. No ordinary invitations or messages.
5. Record final evidence and restore the simulator's normal text size. No app release is part of this approval.

If any deployment guard or isolated test fails, inspect the specific failure rather than widening grants or applying unrelated migrations.
