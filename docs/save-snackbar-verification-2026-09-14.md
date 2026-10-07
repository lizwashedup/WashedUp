# Save confirmation ownership verification

The actual `SaveSnackbar` component was checked with its ordinary four-second timer and controlled completion of native dismissal animations. The tests deliberately let an old animation finish after the visible plan changes, after hiding/reopening the same plan, and after unmounting. They also exercise repeated Share presses, a Share/auto-dismiss collision, an ordinary current dismissal, callback updates for the same receipt, and a new plan receiving its complete display interval.

All eight focused tests in `components/__tests__/SaveSnackbar.test.tsx` pass, along with full TypeScript and the scoped diff check. The staged copy remains the compact “Saved” plus “Share”; default copy is preserved, the action stays at least 44 points, and the exact plan ID reaches the existing Share callback once. An old receipt cannot dismiss or share a newer one. The native component needed no further source changes in this review.

These tests validate callback/timer ownership with Reanimated completions controlled locally. They do not simulate native animation timing or open an external share destination. Root owns the Plans-screen browser review and the existing ShareSheet remains a separate follow-up.
