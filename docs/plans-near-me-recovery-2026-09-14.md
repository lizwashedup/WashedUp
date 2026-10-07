# Plans Near me recovery — isolated repair

## Demonstrated problems

The Plans screen distinguished denied permission from an unavailable position in its text, but both notices called `Linking.openSettings()`. A temporary location failure therefore said “Try again” while opening device Settings. The asynchronous toggle also lacked a synchronous pending lock and a focused-visit check, allowing repeated location calls and late results to enable Near me after leaving the screen.

## Bounded change

`hooks/usePlansNearMe.ts` now holds the existing off-by-default enablement, cached coordinates and notice, plus a pending operation and focused-visit identity. The screen calls `toggle()` only from the Near me button. The new hook uses the unchanged `requestNearMeLocation()` helper; there is no startup or automatic focus permission request.

- A denied notice retains its reason and `recover()` opens device Settings.
- An unavailable notice retains its reason and `recover()` retries the same location helper.
- A successful current request stores its coordinates and enables the existing filter.
- A synchronous ref lock prevents repeated taps before React rerenders.
- The button exposes disabled/busy state while working, with a visible “Finding your location…” or “Opening Settings…” status.
- Blur/unmount retires pending feedback/results. A late operation cannot clear another visit’s pending state or replace its coordinates.
- Exported toggle, recovery and clear callbacks also capture the rendered focus visit. A retained callback from an earlier visit cannot operate on the refreshed page, including its cached coordinates or Settings notice.
- Clear filters disables Near me and clears the notice, preserving an already confirmed cached fix. It retires an unfinished request so that result cannot reactivate the cleared filter.
- Turning Near me off and back on reuses the cached fix, as before.

The screen retains the original 25-mile default, 5/10/25-mile presets, radius conversion and location-parameter query boundary. This package does not change grouping, admission, location provider behavior or server filters. Opening Settings does not claim permission was granted; the next explicit Near me tap checks through the original helper.

## Ownership and limits

The hook guards visible UI ownership. It cannot retract an OS permission request, GPS lookup or Settings launch that already began. No automatic background tracking, account data change, service mutation, native share or production operation was added. This is not a timeout or cancellation redesign of the location provider.

The parent’s actual-component fixture intercepts location and Settings calls. Its unavailable-then-success case checks the visible recovery action; unit tests use mocked provider/Settings boundaries and deferred promises. Native location dialogs and device Settings behavior remain device checks.

## Validation

```sh
npx jest --runInBand --ci hooks/__tests__/usePlansNearMe.test.tsx
npx tsc --noEmit --pretty false
git diff --check -- 'app/(tabs)/plans/index.tsx' hooks/usePlansNearMe.ts hooks/__tests__/usePlansNearMe.test.tsx docs/plans-near-me-recovery-2026-09-14.md
```

The focused suite has **14 passing tests** covering off-state parity, cached fixes, denied versus unavailable recovery, duplicate taps, pending status, blur/refocus and unmount retirement, retained callbacks, old-versus-new request completion, clear behavior and rejected provider/Settings calls. The two retained-callback regression tests failed before the rendered-visit correction. Full TypeScript and the scoped diff check pass after integrating `clearNearMe()` into the parent's Clear filters action.
