# Location preview waiting and Settings recovery

This isolated follow-up improves the existing current-location picker. It supersedes the deferred deadline and Settings-return items in `location-picker-lifetime-2026-09-13.md`; the existing per-visit ownership and confirmation contract remain intact.

## Behavior

- GPS gets up to 15 seconds after foreground permission is granted. A stalled lookup then shows the existing error and explicit **Try again** action. It cannot continue into geocoding when the old native result eventually arrives.
- Address lookup gets up to 5 seconds after GPS returns. If no address arrives, the map and confirmation use the exact GPS latitude/longitude, with the existing five-decimal coordinate label. A late address cannot silently change the reviewed pin or label.
- The OS permission prompt is not timed out. Waiting for a person to answer is distinct from waiting for GPS or an address service.
- **Open Settings** records an intent for this visible visit. After the app becomes inactive/backgrounded and returns active, the picker reads permission once using `getForegroundPermissionsAsync`. It does not prompt again or send a pin automatically. Ordinary foreground events do not reload location. Closing or reopening the modal discards the prior Settings intent.
- Settings-launch failure is visible and retryable. A failed permission-state read uses the existing explicit retry state.
- A false/rejected confirmation now says **“Couldn't confirm delivery. Your pin is still here. Check the chat before retrying.”** This avoids claiming that an uncertain confirmation proves the message was not sent.

Each local deadline is cleared on native completion, dismissal, or unmount. Native GPS/geocoder promises cannot actually be canceled; the local wait settles and eventual native success/error is ignored. Existing request ownership prevents old work from updating a new visit.

## Evidence

The first expanded component suite produced **10 failures and 18 passes**, reproducing indefinite GPS/address waiting, absent Settings-return recovery, absent launch-error feedback, deadline cleanup gaps, and inaccurate send-failure copy. Output: `/private/tmp/washedup-location-wait-before.log`.

The final suite passes **32/32 actual-component tests**, including all earlier lifetime and exact-payload cases plus fake-timer deadlines, successful and denied Settings return, no unrelated foreground requests, stale Settings read/error retirement, explicit retry, full-precision coordinates, and listener/deadline cleanup. Native location and AppState are controlled mocks; there are no device, provider, account, or transport calls.

Command: `npm test -- --runInBand --cacheDirectory=/private/tmp/washedup-location-wait-jest components/chat/__tests__/LocationPickerLifetime.test.tsx`

Output: `/private/tmp/washedup-location-wait-after.log`. Full `npm run typecheck` passed; output: `/private/tmp/washedup-location-wait-tsc.log`.

## Preservation and limits

No styles, provider, map zoom, balanced-accuracy request, privacy behavior, confirmation payload, send gate, or caller API changed. Sharing remains one pin after explicit confirmation; it does not track location. The installed dependency symlink is unchanged. No build was published and no service or schema changed.

These checks establish bounded UI waiting and local lifetime behavior. They do not prove physical-device GPS accuracy, app foreground timing on every OS version, native cancellation, or message delivery. The existing caller must still retire its writable room/account entry when that context changes.
