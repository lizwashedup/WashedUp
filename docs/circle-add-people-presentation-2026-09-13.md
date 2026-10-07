# Circle add-people presentation — September 13

The isolated `AddPeopleSheet` accepts optional `appearance: { fonts: AfterglowFontFamilies }`. The existing Circle route controls whether to supply it. Undefined retains the prior palette, typography and pill action. `PeopleSearchBar` now accepts the same optional appearance without changing its controlled `value`/`onChange` contract.

## Presentation

- Cream sheet, Mona type, clay action and restrained 4px corners; bottom navigation is untouched.
- Photo-left 54px rows use full-color source portraits. A failed or absent portrait uses the displayed name’s initial; changing the person or photo retires the old image callback. Long names wrap.
- The full row remains one accessible checkbox. Selected count stays beside a compact **Add N people** action; no one is added until that action is pressed. Close, retry, search-clear and primary action targets are at least 44px in the staged layout.
- Loading, read failure, no accepted people, everyone already present and search with no matches have separate copy. Read failures offer **Try again**; a retired Circle context offers **Close** instead of an ineffective retry.
- A pending add displays **Adding…**, locks rows and repeat submissions, and remains dismissible. A current failure keeps selection and displays **Couldn’t confirm the add. Your selection is still here.** with **Try again**. Only a confirmed existing mutation receipt invokes the original completion callbacks.

## Preserved behavior

`get_yours_grid` remains the accepted-people source. The viewer and existing Circle members are excluded. The shared local picker filter still searches first names/handles only above 10 eligible people and keeps selected people visible outside a query. If a membership update brings the list below that threshold, the hidden field no longer leaves an invisible filter applied.

The same `invite_to_circle` mutation directly adds selected accepted contacts; this does not introduce community requests, automatic acceptance of strangers, or any changed permissions. Existing per-visit/account ownership and fresh-auth mutation checks remain, including account A→B→A, close/reopen, late completion and immediate duplicate prevention. A previously dispatched add can still finish on the server after dismissal; this sheet does not claim to cancel it. No schema, RPC, hook, route or production changes are included.

## Verification

Passed the existing `AddPeopleSheet.lifetime.test.tsx` suite (19 tests) and new `AddPeopleSheet.presentation.test.tsx` suite (12 tests). The latter renders the actual component with real query/mutation hooks and mocked service boundaries, covering source exclusions, selection/confirmation, retained failure/retry, pending duplicates, close/reopen feedback, image failure/replacement, readable names/action sizes, truthful empty/error states, persistent search input and controlled clear behavior. `git diff --check` passed for the changed source/test files.

Parent integration supplies the route appearance and actual-component visual fixture. Native keyboard, VoiceOver/TalkBack, large text and real-device scrolling remain device verification tasks; renderer assertions do not establish those results.

## Files

- `components/circles/AddPeopleSheet.tsx`
- `components/yours/search/PeopleSearchBar.tsx`
- `components/circles/__tests__/AddPeopleSheet.presentation.test.tsx`
- This handoff document.
