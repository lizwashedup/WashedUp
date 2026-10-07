# Plans filter sheets — isolated Afterglow package

## Scope and source contract

`components/FilterBottomSheet.tsx` and `components/plans/WhenCalendarSheet.tsx` now accept `appearance?: { fonts: AfterglowFontFamilies }`. They use the existing Afterglow paper, ink, clay and Mona tokens only when supplied. Existing callers without the prop retain their legacy palette, fonts, corner styles and bottom padding. Parent feed wiring remains separate.

Category option keys, order, labels and selected values remain parent-owned. Tapping an option still calls `onToggle(key)` immediately, with the original selection haptic. Clear all still calls `onClear()`. Done closes the sheet; it does not introduce a second apply operation or draft filter state.

When uses the unchanged `WHEN_OPTIONS` and forwards the exact `daySelected` and `markedDays` to the existing `WashedUpCalendar` in `filter` mode. It also forwards the optional appearance. The calendar retains LA day semantics, past-day restrictions, month navigation, month jump and marked-day dots. Selecting a calendar day still calls `onSelectDay(day)` immediately. The parent's existing coarse-filter versus exact-day mutual exclusion remains outside this component. No date computation, filter payload, RPC, query, route or eligibility code changed.

## Presentation and reachable controls

The staged sheets use an eight-point top corner, four-point option/check/action corners, restrained dividers, a readable title and single-line Clear all and Done labels. Category labels can wrap without pushing the selection control off-screen. Clear all is at least 44 points; category rows are at least 52; coarse date controls are at least 44; Done is at least 48. The existing calendar's optional presentation supplies its accessible day/month targets.

Both sheets use the current window height and safe top inset for their maximum height. The option list or calendar scrolls vertically, while the title/Clear all row and Done remain outside that scroll area. The date shortcuts keep their existing horizontal scroll. Only the grabber owns downward dismissal; calendar/option scrolling no longer competes with a pan responder attached to the entire sheet. Android back, accessibility escape and the labeled backdrop share the same guarded close operation.

## Demonstrated lifetime repair

Previously a module-level screen height stayed stale after rotation. The lifetime `PanResponder` captured the initial close callback, and dismissal called that callback regardless of animation completion or whether the sheet had closed and reopened. Clear/toggle/day callbacks had no visible-visit guard.

Each visible presentation now mounts a contained child with its own lifetime refs. Hiding/unmounting the sheet retires its callbacks and stops its animation. Selection, Clear all and day callbacks require that visit to remain mounted and neither closing nor closed. Within the same visit they use the latest callback props. A new visible presentation cannot be changed by a callback from the old child.

Dismissal locks immediately and closes at most once, only after a finished animation whose attempt still belongs to that mounted visit. An interrupted animation restores the visible position and permits another interaction. Rotation settles the existing presentation and invalidates the old close completion. Drag handlers use the current dismissal callback and current height. The existing entrance/dismissal timings and spring-back behavior remain.

This is a component-lifetime repair, not a new modal framework or a change to filter persistence. Native gesture smoothness, device text scaling, safe-area behavior and the parent’s actual-component browser presentation still require their separate visual/device checks. These tests do not prove native layout bounds or screen-reader focus behavior.

## Validation

The first 19-case source test run against the original components had 17 failures and two passing hidden-render checks. It demonstrated the stale close callback, duplicate/unchecked completion, old-visit actions, rotation and missing scrolling/appearance contracts. After the bounded repair, all 19 pass.

The unchanged real-calendar presentation suite also passes, covering LA date shortcuts, past-day restrictions, current-month navigation, month jump and exact selection payloads. The new sheet suite mocks only the calendar boundary to check exact forwarding and stale day callbacks; it does not replace that real-calendar coverage.

Final checks:

```sh
npx jest --runInBand --ci components/plans/__tests__/FilterSheets.lifetime.test.tsx components/composer/__tests__/CollapsibleCalendar.appearance.test.tsx
npx tsc --noEmit --pretty false
git diff --check -- components/FilterBottomSheet.tsx components/plans/WhenCalendarSheet.tsx components/plans/__tests__/FilterSheets.lifetime.test.tsx docs/plans-filter-sheets-afterglow-2026-09-14.md
```

Result: **25 tests across two suites pass; full TypeScript and scoped diff checks pass.** No live service calls, production changes or shared calendar edits were performed in this package.
