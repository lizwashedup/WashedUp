# Own profile and settings — isolated staged port

This package uses the existing `COMMUNITY_CHAT_GROUPING_ENABLED` development gate for the optional Afterglow appearance. It changes the own-profile route and its contained form helpers, not the native bottom navigation, public profile route, authentication provider, schema, or live configuration.

## Presentation

The profile, edit form, neighborhood picker, settings rows and existing branded confirmations use the established cream, ink, clay and Mona tokens. Settings use restrained dividers instead of rounded cards; form controls retain compact four-point corners and at least 44-point action targets. Current profile photography stays in full color. An unavailable photo falls back to the actual name initial, with keyed photo identity preventing a late image failure from affecting a replacement photo. The existing handle stays under the display name. The founder-required `your tickets` label is retained.

## Existing contracts preserved

- The own-profile read selects exactly `id, first_name_display, profile_photo_url, bio, city, gender, handle, neighborhood, is_visitor, fun_fact` for the captured account ID.
- The edit update retains exactly six fields: `first_name_display`, `profile_photo_url`, `handle`, `neighborhood`, `is_visitor`, `fun_fact`. There was no rendered bio input in this source; the unused prior `editBio` state has not become a new field.
- Display name remains required and limited to 30 characters. Handle remains lowercase letters, numbers and underscores, maximum 20 characters and minimum two when changed. Existing unchanged or absent handles preserve their original eligibility. Fun fact remains optional, maximum 120 characters. Other neighborhood remains limited to 40 characters. Existing content filtering, neighborhood options, visiting/resident state, and read-only gender/support guidance remain.
- Camera/library choice, native permission calls, square cropping, 800-by-800 JPEG preparation at 0.85 compression, and the `profile-photos/{account}/{timestamp}.jpg` upload remain. Upload results must complete before their returned URL is saved.
- Native handle sharing, tickets, legal/support links, notifications, approved creator destinations, pending application states, administrator destinations and original routes remain. Creator access, pending grants and optional organizer naming stay independent so partial failure does not suppress confirmed destinations.
- Deletion preserves both rendered confirmation stages, the typed DELETE gate, retention disclosure, session refresh, `delete_own_account`, the existing captured-token `delete-user` fallback, deliberate sign-out timestamps, known-account removal, unauthenticated route reset, and sign-out. Saved server rejection, including pending-payout safeguards, is not bypassed. No destructive action was performed against a real account.

## Correctness changes

Handle availability is explicitly checking, available, taken, invalid or failed. Failed queries never claim availability. Replies are bound to the particular normalized input, edit scope and retry identity, including A → B → A edits and closing/reopening the same name. The original exact-handle query excludes the original account ID. Its 500 ms debounce remains; saving is disabled while the current result is unknown.

Profile reads, edit actions, photo callbacks and saves carry observed account generation and focused screen/edit ownership. Read error, loading and unavailable states are distinct. Saving takes an immutable snapshot, verifies the original authenticated account around asynchronous work, and requires an exact one-row update receipt before closing or announcing success. Duplicate immediate taps are locked. `openEdit=true` is consumed once rather than reopening or resetting a draft on a later read.

Staged failed-save feedback explains that the draft remains: “Your changes are still here. Try saving again.” Known handle conflicts and required-name validation retain useful, fixed copy; arbitrary transport and database text is not displayed. The legacy appearance retains its original error helper.

Explicit edit Back/Cancel remain unavailable during a pending save; closing an edit is never presented as undoing a dispatched write. If native navigation retires an in-flight save, its completion cannot close or overwrite a newer edit. A same-account retired completion requests a current read, and the next focus bypasses the normal 20-second read throttle. Pending save locks survive focus changes until the operation settles and its required reconciliation read finishes. That read supersedes any refocus read started before the write settled; a late pre-save snapshot cannot overwrite the reconciled profile.

Explicit deletion exits remain unavailable while deletion is pending. Before the destructive RPC, ownership includes the active account and confirmation visit. After dispatch, cleanup is owned by a short-lived auth observer independent of component/focus lifetime, so native navigation cannot discard cleanup of a confirmed deletion. A replacement account, including sign-out then sign-in to the same ID, permanently retires that cleanup. Deletion itself may clear the original session; a null session alone is therefore not treated as another account. The observer is removed when the operation settles. Its callback performs no asynchronous provider work.

The notification enable path retains its structured registration result, passive check, permission-required prompt, denial handling and Settings callbacks. Only its captured screen ownership is strengthened; provider/token behavior is unchanged.

## Verification and boundaries

Focused tests exercise the real helper/hook and actual own-profile route against controlled service boundaries. They cover field/payload preservation, failed and stale handle reads, input/account/edit ABA, one-row save confirmation, photo failure/late permission, pending exits, fresh reads after retired saves, creator partial failures, native share/routes, deletion rejection and account-owned cleanup, and old logout confirmations. Existing notification feedback coverage is rerun with this route.

Final local verification: **80 tests pass in four suites**, full `tsc --noEmit --pretty false` passes, and scoped `git diff --check` passes. The three new suites cover 53 cases; the existing notification suite covers 27.

This is local implementation and test coverage. Browser fixture review is managed by the parent task; it uses actual components with intercepted local service boundaries. Real-device keyboard, text scaling, camera/library permissions, storage uploads, provider registration and production account behavior still need the staged device/integration checks. An already dispatched server write cannot be cancelled or undone by a client scope. This package does not introduce server idempotency or claim that a timed-out write failed to persist.

Owned files:

- `app/(tabs)/profile.tsx`
- `components/yours/profile/settings/profileOperations.ts`
- `components/yours/profile/settings/profileSaveFeedback.ts`
- `components/yours/profile/settings/useProfileHandleAvailability.ts`
- `components/yours/profile/settings/SettingsPortrait.tsx`
- `components/yours/profile/settings/__tests__/profileOperations.test.ts`
- `components/yours/profile/settings/__tests__/useProfileHandleAvailability.test.tsx`
- `components/yours/profile/settings/__tests__/ownProfileSettings.test.tsx`
