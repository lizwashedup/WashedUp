# Location preview lifetime

The current native control shares one current-location pin. It has foreground permission, GPS and reverse-geocoding stages; it does not contain autocomplete or a place-detail search. This package fixes operation ownership in that existing flow, with no provider or location-feature addition.

Before changing `components/chat/LocationPickerModal.tsx`, the actual component was exercised with controlled permission, GPS, address and confirmation promises. The initial suite produced **13 failures and 5 passes**. Reproduced failures included old permission work starting GPS after dismissal, an old GPS/address result replacing a reopened preview, old errors replacing a new ready screen, queued close/send/settings/retry callbacks acting on the next visit, and a late send finalizer releasing a newer visit's send lock.

After the repair, **18 of 18 tests pass** in `components/chat/__tests__/LocationPickerLifetime.test.tsx`:

```sh
npm test -- --runInBand --cacheDirectory=/private/tmp/washedup-location-jest components/chat/__tests__/LocationPickerLifetime.test.tsx
```

Evidence logs: `/private/tmp/washedup-location-before.log` and `/private/tmp/washedup-location-after.log`.

Each modal opening now owns a distinct local visit. Closing retires it synchronously before the parent applies `visible=false`; reopening resets the preview and operation tokens. Every awaited native result checks both its visit and request token before starting another stage or writing state. A selected latitude/longitude/address snapshot is accepted together and passed unchanged to the existing `onConfirm` callback. Send and retry launches acquire synchronous ownership; old completions cannot release a newer operation's lock or publish errors into its view. Close controls remain unavailable during the current confirmation attempt.

The original map provider, balanced accuracy request, map zoom, address ordering, coordinate fallback, one-pin privacy text, `Promise<boolean>` confirmation contract, caller-owned successful dismissal and styles remain unchanged. Existing caller props are unchanged. No actual device permission, GPS, map service, message transport, production state or schema was accessed by the tests. The existing dependency symlink was not modified; Jest caches and logs stayed in `/private/tmp`.

The local visit is keyed to visibility and mount lifetime. Room/account changes while a caller deliberately leaves `visible=true` still require that caller's admission/entry scope, or closing the picker; this package does not replace the main/topic screen's existing guards. Native location promises cannot be forcibly canceled by this component, so retirement prevents their follow-up stages/state acceptance; it does not claim to cancel operating-system work already started. A finite deadline and settings-return permission refresh remain separate usability work. These tests establish local lifetime and exact payload behavior, not real-device GPS accuracy, delivery or final visual approval.
