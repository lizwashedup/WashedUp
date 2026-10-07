# Circle creation: staged native presentation

The isolated Circle creation package accepts `appearance?: { fonts: AfterglowFontFamilies }` on `CreateCircleFlow`, `PeopleStep`, `IdentityStep` and `PermissionsStep`. The route supplies this existing development-gated appearance. It does not replace the global theme or bottom navigation.

## Preserved source contract

- Original sequence: choose people, name the Circle, choose who can add people.
- The existing accepted-people grid remains the source. A Circle requires the creator plus at least two other people.
- Suggestion `seed` IDs are intersected with visible accepted people and applied once. Picks remain removable. A disappearing connection cannot remain an invisible selected member/admin.
- Name remains required, limited to 60 characters. Description remains optional, limited to 140. Cover remains optional and uses the existing picker/compression helper.
- The `only_me`, `chosen` and `everyone` policies retain their existing meanings and RPC parameters. Chosen administrators come only from selected people. Removing a member removes their administrator selection. Chosen with no checked administrators retains the previous allowed behavior.
- The Circle page remains the confirmed success destination. A seeded suggestion is marked converted only after confirmed creation; the existing setter is awaited best-effort while “Finishing…” is visible. A conversion failure does not recreate the Circle or prevent entering it.

## Presentation

Cream background, Mona type, clay actions, small control corners, readable labels and a compact step counter. People/admin rows use full-color 54px photos, keyed photo-error fallbacks and native checkbox state. Existing local search threshold/selected-person visibility remains; a hidden search field cannot keep filtering a now-small list. The shared PeopleSearchBar supplies the optional appearance.

Identity fields have persistent required/optional labels. The selected cover preview uses the complete picked image inside the existing 16:10 frame; a broken preview falls back to the Circle monogram. Cover picking exposes pending/error state; cancellation keeps the current selection. Empty people content can scroll, and an unusable disabled Next button is omitted there.

## Creation, partial setup and ownership

`useCreateCircle` now returns a typed confirmed receipt `{ circleId, policyApplied, coverApplied }`. This flow uses that receipt rather than assuming all refinements succeeded. Root owns the shared hook implementation and its RPC tests.

- Full success opens the existing Circle page.
- A definite creation rejection retains the draft for retry.
- An ambiguous creation response offers “View circles”; it does not offer blind create retry.
- Partial permission/cover setup retains the confirmed Circle ID. “Try again” calls `retrySetupAsync(circleId)` with the hook’s retained original setup. It never invokes create again. “View circle” remains available.
- Immediate local locks prevent duplicate submit/setup/picker actions before pending state renders. Name, selected members, permission selection and cover data remain in the completed visit and the hook’s immutable setup snapshot.
- Drafts are keyed to observed account generation and input route parameters. Account/visit/unmount and picker-step ownership prevent stale selection, error or navigation callbacks. Read failure/loading stays distinct from an empty People list.

## Verification and boundaries

Focused suites: `components/circles/create/__tests__/CreateCircleFlow.test.tsx` and `CreationPresentation.test.tsx`. They cover original selection/policy/seed contracts, photo failure/cancel/late result, loading/error distinction, ambiguous and partial outcomes, setup retry, duplicate controls and obsolete callbacks. The shared create hook has separate actual RPC/lifetime coverage owned by root.

All calls in tests and preview fixtures use service stubs. No production data, auth settings, SQL, live creation, upload or delivery was changed. Real-device keyboard, permission-sheet and photo-picker behavior still require device review. The existing photo helper returns null for both cancellation and permission denial; this package does not invent a failure message for a cancelled selection.
