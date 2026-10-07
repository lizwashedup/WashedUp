# Composer people controls — isolated optional appearance

`InvitePeopleSection` and `PeoplePickerSheet` accept `appearance?: { fonts: AfterglowFontFamilies }`. The caller supplies the existing development-gated fonts. Default presentation remains available.

The staged controls use the existing Afterglow tokens, full-color circular portraits, name/real-handle rows, four-point corners, and at least 44-point actions. Selected people use compact horizontal chips with accessible remove controls. The Invite button retains the documented gold fill for responding to someone who already raised a hand. Missing or failed portraits use the person's actual initial; keyed photo identity prevents an older image error from replacing a newer portrait. Only supplied handles render; the picker carries a supplied normalized handle alongside the unchanged ID, name and photo. No extra profile query is added.

The composer still owns suggestion merging, capacity, invitation submission, dismissal/undo and chip state. The first-six suggestion cap, See more, source order, real shared-plan ranking, accepted-people query, exclusions, selected visibility during local search, and original callback payloads remain. This picker performs no invitation write. Staged loading, failed-read retry, successful empty lists and no search matches are distinct.

Two narrow lifecycle fixes accompany the port: Close synchronously retires old Confirm/selection callbacks before unmount, including stale account-sheet callbacks; rejected retries stay in the existing error state. A smaller refreshed people list no longer remains filtered by a query whose search field has become hidden. Tests cover the precise close/confirm gap, stale account close, retry rejection and hidden-search regression.

Local verification: 21 tests pass across the two child suites (17 picker, 4 invitation section); full TypeScript and scoped diff check pass. A contemporaneous combined composer run encountered the main agent's in-progress focus-hook test mock; parent integration checks will rerun against the completed composer. No live invitations, shares or other service writes were performed. Root owns browser/real-device verification.

Files changed: `components/post/InvitePeopleSection.tsx`, `components/post/PeoplePickerSheet.tsx`, their two tests, and this note.
