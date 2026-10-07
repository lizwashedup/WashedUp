# Plan card hierarchy comparison — September 13

Liz proposed moving the creator below the activity, so the card leads with its title. After reviewing the recommendation, Liz approved it ("yeah lets do that then"). Title-first is now the shared PlanCard default in the isolated copy. Nothing was released.

The selected `layout="title-first"` renders the same PlanCard with its title, category/eligibility information, creator note and logistics first. The complete creator row follows, retaining the real photo (or existing missing-photo fallback), name, milestone and profile action. Share and Save sit at the top right alongside the title (Liz’s September 13 refinement). The existing footer follows unchanged. This makes activity information the first scanning cue and keeps creator information beside the decision area.

`creator-first` remains available for comparison. The older, separate `activity-first` experiment component is unchanged; its avatar-stack/no-name composition was not reused because this proposal should retain the creator's name. The feed now uses the shared default instead of its old activity-first experiment selector. Yours, plan sections and duplicate-plan rail use that same default. No feed query, joining introduction, admission rule, capacity calculation, route, saved-state callback or bottom navigation was changed. The review uses fictional data and a local transport boundary.

The comparison uses two instances of the actual component with identical data and state, not separately drawn mockups. It includes open, full/long-title, already-joined and past cases, with 375px and 430px frame widths, plus a 300px compact-rail stress case. [Open comparison](http://127.0.0.1:8843/plan-card-hierarchy-review.html). It is linked from the existing Yours review.

## Recommendation and evidence

Selected rationale: WashedUp helps someone find an activity and people to do it with; the title/date/place should be easy to scan. Creator identity remains important context before joining. Consistent information order supports scanning: [Nielsen Norman Group, List Entries](https://www.nngroup.com/articles/list-entries/). That source supports the hierarchy rationale, not a claim that this exact change increases joining. Reduced hesitation or increased joining remains a hypothesis requiring user observation or a controlled rollout.

Ten existing/expanded PlanCard checks pass after approval, including the new default-order assertion. They cover opt-in appearance, same plan/profile destinations, saved-state/share callbacks and member/full/past distinctions; the new candidate retains the same text and creator control in a different order. Actual React Native Web rendering was inspected at 375/430; the long title and full-plan footer fit. That first pass retained the two-line title clamp. The later Share-placement refinement below replaces it with full title wrapping; the quote clamp and wrapped footer remain. Save and creator-profile actions were exercised on the direct component preview. The comparison's cross-frame action automation was unavailable, so controls were tested on the same component outside the iframe. No real share was sent.

This comparison does not prove native Dynamic Type, VoiceOver or feed-scroll performance, and does not constitute a full Plans redesign. Evidence and fixture source: `/Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/plan-card-hierarchy/`.

## Final integrated check

The combined nine-suite client/card run passes **194/194**, full app TypeScript passes, static auth invariants pass, and scoped diffs are clean. [Combined log](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/notification-reliability/integrated-client-card-tests.log>). Actual browser review covers the selected card at 300/375/430 and the shared chat’s pending, failed and successful enable-feedback states with synthetic registration results. This does not establish native OS or provider delivery.

## Share placement refinement — September 13

At Liz’s request, Share and Save now sit together at the top right in title-first cards. They are plan-level actions; creator identity stays near joining. Both retain their original payload/state callbacks, selected labels and propagation guards. Real 44-point touch targets remain, with glyphs aligned to the first title line. Long titles wrap rather than truncating into the action group. The scarcity badge stays with the creator/join area, away from the title. Creator-first comparison and activity-first experiment layouts are preserved. Ten existing PlanCard behavior tests and full TypeScript pass. Actual rendering was checked at 300/375/430 widths, including the long title and full-plan actions; the Share target measured 44 × 44 points (browser rounding 43.994). This is an isolated presentation change, with no live release or real share sent.


## Compact creator-below-divider candidate — September 13

Liz clarified that moving Amelia below the divider should shorten the card. The first comparison added a separate action row and was rejected. The corrected opt-in `creatorPlacement="after-join"` places date/location left and capacity above the joining action on the right, with the complete creator/profile row below the divider. Share and Save remain at the top. The shared default is unchanged pending this visual decision.

Actual React Native Web measurements: the open fixture is 317 → 289 points (28 shorter) in both 375- and 430-point frames. Font sizes and touch targets are unchanged. Full plans with both Post your own and Waitlist use a full-width decision row and measure the same 355-point height as the current arrangement at 375. The 300-point stress case wraps the full-plan actions without clipping. Existing callbacks, date/place formatting, admission navigation and full/member/past distinctions remain. The scarcity indicator moves to the decision area only for this candidate.

Existing PlanCard regression tests pass 10/10; the optional placement itself was reviewed through source inspection and actual-component browser rendering, not a dedicated automated test. TypeScript also passes. Browser evidence is not a physical-device or large-text approval. Review: `http://127.0.0.1:8843/plan-card-footer-review.html`. No production changes or real shares.
