# People rows: isolated presentation port

September 13, 2026. This is the optional native presentation selected after the People layout review. It is not a release or proof of production behavior.

## Component contract

`PeopleScreen` now accepts `appearance?: { fonts: AfterglowFontFamilies }`. Its absent value retains the existing grid and prior palette. The provided value opts this screen into the existing Afterglow colors/type and the new `PeopleListRow` / compact `PeopleRecentPerson` components. The parent owns the existing development gate and supplies the appearance; no screen-level global palette or navigation change is made here.

The row keeps a 54-point full-color photo, actual display name and one factual context line. Upcoming weekday/title describes the other person's visible plan without claiming the viewer also joined. Otherwise the line is the existing shared-plan count or handle; unsupported metadata is omitted. Recency never fades photos or labels in this presentation. The recent collection keeps the existing `ring_bucket === 'full'` membership and received order. The full list keeps `compareByFirstName` and never sorts the supplied array in place.

Main row tap still calls `onPersonPress(person)`. The explicit 44-by-44 options target is a sibling of the row target, so it does not bubble to the primary person action. Options and existing long press call the supplied `onLongPressPerson(person, avatarRect)` using measured avatar coordinates. Pending measurements are retired when identity, callback scope or mounted lifetime changes. Existing parent feature gates remain authoritative.

Photo failure renders the person's initial. The photo child is keyed to person and URL, which permits a replacement URL to load and prevents late errors from hiding another person's photo. There are no recency-dependent opacity styles.

## Preserved behavior

The existing ScrollView and TextInput remain mounted while browse sections collapse for search and reappear. The supplied `searchResults` node is rendered without reconstructing search or changing query semantics. `keyboardShouldPersistTaps="handled"`, the query callback, scroll-to-top behavior, request entry, Add people and Create a circle callbacks remain. No RPC, subscription, storage, route, connection, permission or notification code changed in these owned files. Existing all-items scrolling remains; this port does not claim large-collection virtualization or measured device performance improvements.

## Verification

`node node_modules/jest/bin/jest.js --runInBand --watchman=false components/yours/people/__tests__/PeoplePresentation.test.tsx`

20 focused checks pass: input/scroll retention; supplied-result ownership; recent and full-list ordering; default-grid preservation; requests and add/create callbacks; exact row/menu identity and sibling targets; long press; unchanged photo opacity across recency; factual context; missing/failed/replaced photos; and retired or invalid menu measurements.

Native keyboard, large-text, screen-reader, long-list scrolling and platform photo delivery still require device checks. Parent integration and browser/component visual review are separate checks, not established by this suite.

## Owned changes

- `components/yours/people/PeopleScreen.tsx`
- `components/yours/people/PeopleListRow.tsx`
- `components/yours/people/__tests__/PeoplePresentation.test.tsx`
- This note.
