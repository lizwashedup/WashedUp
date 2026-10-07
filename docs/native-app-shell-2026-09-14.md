# Native app shell review — September 14, 2026

The iPhone 17 Pro Max simulator now runs the actual isolated app root, Expo Router route tree and existing bottom tabs: Plans, Scene, central +, Chats, Yours. The earlier component toolbar is not used by this entry. The root and screens are imported from the isolated native checkout; service data is fictional and in memory.

## Verified

Native taps reached Plans, Scene, Post, Chats and Yours. Post Cancel returned to Plans. Yours showed its existing first-visit notice, Plans and People destinations. Plans opened the actual member detail with named attendees and handles; Back restored Plans and the bottom bar. Final screenshot shows Plans with real navigation. These are native navigation checks, not completion of every screen/state.

Five existing photo-helper tests pass. Native TypeScript and preview TypeScript pass. Metro bundled the full actual route tree (4,628 modules after helper relocation). The root no longer reports the three incorrect community child names or the photo helper as a route.

## Source changes in this package

- app/_layout.tsx registers community, community-thread and community-topic at their existing layout boundaries. The layouts and their access gates are unchanged.
- app/(tabs)/_layout.tsx adds the accessible name Post a plan to the visually unlabeled + button.
- app/plan/plan-photo-edit.ts moved unchanged to lib/planPhotoEdit.ts; the detail import and existing test import follow it. It is a helper, not a navigable screen.
- Temporary native-app review entry/config/sample service created outside app source. No real account or provider client is used by the sample service; writes return an explicit local-review error.

## Review limits and next work

This is a working shell review, not final structure or release readiness. Scene still has its legacy title/visual treatment. Main page title case and spacing need a consistent pass against the selected design. Tab accessibility ordinal counts include hidden routes (five visible destinations currently announce a total of eight); retain this as an accessibility follow-up. Joined feed/personal cards still need CTA parity with member detail. Creator/organization and auxiliary surface coverage, real backend behavior, real device keyboards, deep links and notification journeys remain outstanding.

Sample service has explicit fixtures for the demonstrated reads. Unsupported queries are not production errors: they are logged sample gaps and must not be treated as proof of empty real data. This package is read-only navigation verification; it does not prove server authorization, write receipts or delivery. Preserved original checkout and production were not modified.

## Reopen

Start: sh /private/tmp/washedup-native-app-review/start.sh
Port: 8847. Metro uses CI mode; restart after edits.
Simulator: 6DBCB4BE-3283-4B8A-9F6A-8A83F74CF802 (iPhone 17 Pro Max).
Open exp+washedup-local://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8847 using simctl for that exact device.
Installed bundle: com.washedup.localdev. Do not use generic booted when multiple simulators are running.
