# Circle plan composer presentation — September 13, 2026

Local isolated implementation. This is optional presentation on the existing composer, not a production release or a new creation flow.

## Contract

`CirclePlanComposer` now accepts `appearance?: { fonts: AfterglowFontFamilies }`. The default remains the existing palette, type and labels. The optional presentation uses the reviewed Afterglow tokens and the existing BottomSheet appearance. It provides compact audience cards, readable labels, actual 44px or larger controls, recipient photos in full color with an initial fallback, and a short **Post plan** button that shows **Posting…** during the current attempt.

The staged audience selector and its nested choices are separate controls. Selecting a person or changing capacity does not place one interactive button inside another. The form remains one vertical scroll surface; its controls retain their existing order and draft values. Failed photos do not affect recipient selection, and a late failure for a replaced image cannot hide the new image.

The shared title, category, place, calendar, time and nudge controls retain their current components and callbacks. The same optional appearance now reaches all six controls. `CollapsibleCalendar` forwards it to the existing `WashedUpCalendar`; `TimePicker` applies it to its existing direct-entry modal. No replacement picker has been added. Calendar month controls and shortcuts have 44px targets; the seven-column day grid uses 44px-high rows with responsive widths, so day cells are narrower than 44px on a 320px screen.

## Preserved behavior

- Just us with everyone uses `circle_only`, null subset and the existing Circle-chat result.
- Just us with selected people requires at least one selected member and submits that exact array. Its own-chat result remains server-defined.
- Open it up requires a description, submits `open`, and preserves its separate-chat/feed outcome.
- DM composition still omits subset selection.
- The complete draft remains: title, canonical category, place name, date, hour, arbitrary valid minute, AM/PM, description, audience and selected members. Category still maps to lowercase `primary_vibe`; the location payload remains `location_text` rather than newly introducing coordinates.
- LA wall-clock conversion, future-time validation, admission scope, current-attempt lock, close/reopen/account retirement, later draft preservation, current error/retry, and close-before-navigation behavior remain.
- The sheet and optional styling do not change SQL, release flow, membership gates or server chat selection.

## Two-person capacity correction

The visible and submitted maximum for `isDm=true` is now six additional people. Other Circle entries keep the existing seven; both keep a minimum of two and initial value four. Repeated retained stepper callbacks cannot exceed those bounds.

The saved creation migration `supabase/migrations/20260824180000_fix_dm_circle_plan_stranger_cap.sql:77` counts joined members and clamps any exactly-two-member Circle to six. Circle members are separate from outsider capacity; this is not a total group-size cap. The client correction follows the requested DM classification. A named two-member Circle can still be classified non-DM while that saved SQL counts two; align those definitions as a separate backend/source release check. The saved `release_circle_plan` definition also accepts 2–7 without that creation clamp. Neither SQL path was modified or executed.

## Focused verification

`components/circles/plan/__tests__/CirclePlanComposerLifetime.test.tsx`: **26 passed** (17 prior lifetime checks plus 9 presentation/preservation checks).

Added checks cover default styling, scroll sizing and touch targets, separate audience/child controls, DM-six and Circle-seven limits, minimum-two/private restoration, category/place/arbitrary-minute payload preservation, posting/failure/retry, and failed/replaced recipient photos.

`components/composer/__tests__/TimePicker.accessibility.test.tsx`: **12 passed** (9 existing checks plus 3 staged checks).

`components/composer/__tests__/CollapsibleCalendar.appearance.test.tsx`: **6 passed**, using the actual expandable control and actual calendar. Covers legacy appearance, staged selection, LA year-boundary shortcuts, past-day/current-month restrictions, month jump, and date typography.

**44 focused checks passed.** Full `tsc --noEmit --pretty false` passes after the shared-control and creation APIs landed. Diff whitespace checks pass for the owned source. Root performs the final cross-package suite and actual-component browser review; native keyboard, Dynamic Type and VoiceOver verification remain device checks. No production action has occurred.
