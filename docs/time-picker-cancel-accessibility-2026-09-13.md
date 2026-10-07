# Time picker cancellation and accessibility — September 13, 2026

This bounded local package improves exiting the existing shared time sheet without changing date/time rules or the existing direct-entry mechanics. It does not complete the broader composer visual redesign.

## Defect and repair

Previously the sheet had no visible Cancel action. Its only explicit action, Set time, becomes disabled for invalid input; cancellation depended on backdrop dismissal or the platform back action. The opening row also lacked an explicit button role, selected-time label, and expanded state. The pressable sheet containers could group their child controls as an accessible element.

The sheet now has a labeled Cancel action with a minimum 44-by-44-point target. Cancel, backdrop dismissal, platform back, and the native accessibility-escape callback all use the same discard handler and dismiss the keyboard. The container does not group its inputs/buttons into one accessible item; its title is a header and the form declares modal accessibility containment. The opening row announces its current time, or that it is not set, and exposes expanded state.

A local opening identifier prevents a callback retained before cancellation from confirming old edits or canceling a later opening. The existing confirmed value remains untouched until Set time runs; reopening initializes the fields from that confirmed value.

## Preserved behavior

The component's public props and exact `onChange(hour, minute, period)` payload remain unchanged. Direct hour/minute entry, digit filtering, zero-padded confirmed minutes, AM/PM, 00/15/30/45 shortcuts, invalid-range validation, haptics, safe-area calculation, keyboard avoidance, and Los Angeles time copy remain. No date, time-zone, capacity, eligibility, payment, or creation gate changed. Existing Colors/Typography constants are reused. No new feature flag or appearance mode was introduced; the default visual treatment remains apart from the clear secondary Cancel/header arrangement.

`CollapsibleCalendar.tsx` and `WashedUpCalendar.tsx` were not edited. Their already-staged shortcuts, selected-month opening, and month jump remain outside this package.

## Verification

- Actual component suite `components/composer/__tests__/TimePicker.accessibility.test.tsx`: **9/9 passed**.
- The same final suite against the frozen pre-change TimePicker: **5 failures / 4 positive preservation cases**. The baseline transformer substitutes the saved source while retaining its original import paths; it does not overwrite the working file.
- Full `tsc --noEmit --pretty false` and diff whitespace check passed.
- Local component bundle built successfully using the existing fixture runtime and read-only node_modules symlink. No packages were installed.

## Browser review

The new local-only route is `http://127.0.0.1:8845/?view=date-time`. It renders the actual TimePicker and unchanged CollapsibleCalendar. Its labeled review controls and commit counter operate only on local state. Existing media, conversation, and default fixture routes are unchanged.

Verified in Chrome through the documented CUA browser API at **375×812** and **430×932**:

1. At 375, invalid `99:88` shows the existing error and disabled Set time while Cancel remains enabled. The new Cancel measured approximately **62.93×44 CSS pixels**.
2. Cancel closes the sheet, returns keyboard focus to the opening row, preserves `7:00 PM`, and leaves the fixture confirmation count at zero. Reopening restores hour 7, minute 00, and PM.
3. Keyboard Enter opens the row; browser Escape discards an edited hour and restores row focus with the original saved time unchanged.
4. At 430, direct `2`, `5`, `AM` confirms exactly `2:05 AM` once.
5. Canceling an unset-time sheet keeps its value unset and confirmation count zero.

Temporary browser viewport sizing was reset and the verification tab was closed. Screenshots, fixture sources, and a structured verification record are saved in:

`/Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/time-picker`

Representative views:

- `375-valid.png`
- `375-invalid.png`
- `375-canceled.png`
- `375-escape.png`
- `430-valid.png`
- `430-confirmed.png`
- `430-unset-canceled.png`

## Boundaries

Browser keyboard/focus checks are not proof of iOS/Android numeric-keyboard layout, VoiceOver gestures/announcements, or native Dynamic Type. Those device checks remain open. The 44-point target claim applies to the new Cancel control; this package does not certify the older minute shortcuts or all other controls. No Simulator, microphone, location, provider, production, database, auth, or deployment operation was performed.
