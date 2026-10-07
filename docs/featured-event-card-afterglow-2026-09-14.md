# Featured event card — staged Afterglow

The existing `FeaturedEventCard` accepts optional `appearance: { fonts }`, with the same type as `PlanCard`. Default callers retain their prior visual presentation. The staged card leads with its title and details, then shows the creator's complete photo/name/posted identity above the original attendee stack and action. It uses the existing cream, ink, clay and Mona tokens, readable wrapping, six-point card corners and 44-point controls. Birthday, special-event and WashedUp labels remain distinct; Pride's existing artwork appears at full color beside the label. Confirmed Going retains its documented gold affirmation.

No fetching, eligibility, admission or capacity rule changed. Both card and CTA still open `/plan/{id}`; saved-state callbacks, report/block IDs, LA logistics, link-location suppression, first-five attendee photos and overflow count remain. The source has no creator profile callback or creator ID, so none was invented. `wishlistPending` and `wishlistDisabled` default false; when supplied, the save control stays visible, blocks presses, and exposes pending/busy feedback.

Native sharing retains the exact `buildPlanShareContent` message plus newline plus URL contract. A demonstrated unhandled native rejection now uses the existing alert. A synchronous lock prevents duplicate native sheets, and late failures or retained share callbacks cannot affect a replacement card or unmounted card. Cancellation releases the lock without claiming that anything was shared.

Validation: 18 focused tests pass in `components/plans/__tests__/FeaturedEventCard.test.tsx`, including exact share payloads, deferred/rejected sharing, identity replacement/unmount, saved states, both member states, featured variants, and platform report/block callbacks. Scoped diff check and full TypeScript pass after the concurrent feed/filter edits were completed. Root owns the integrated 320-point browser review and final aggregate checks. No live sharing or other external action ran.

Files: `components/plans/FeaturedEventCard.tsx`, its focused test file, and this note.
