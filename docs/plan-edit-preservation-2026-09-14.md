# Plan editing: preserve existing rules — September 14, 2026

The product goal requires changing a title without quietly changing who can join or when a plan ends. This bounded package repairs existing rule-preservation defects in the isolated creator editor. It is not the completion of creator management or its visual port.

## Implemented

- All Featured fields now start from a single opening snapshot. Closing without saving discards Featured changes; a background detail refresh does not replace the open Featured draft.
- Custom and one-sided saved ages are shown truthfully. They are omitted from the update until the creator explicitly changes the age control, so a title-only save cannot turn custom bounds into All Ages.
- Time fields are omitted unless changed. Confirming the same displayed minute preserves the exact stored timestamp, including seconds and the chosen instant during the LA repeated-hour transition. A changed start moves a valid explicit end by the original elapsed duration. No end is invented for a null end. An invalid saved duration blocks a date change with a clear explanation.
- Ordinary capacity changes and Featured changes are sent only when edited. Ordinary capacity controls are hidden while Featured is active. Circle plans do not expose these unrelated controls and never write ordinary/Featured capacity from this editor; Circle public allowance and unlimited Circle-member admission remain separate.
- Creator-message copy now matches the saved maximum of 150 rather than claiming a nonexistent database minimum.

## Verified

258 tests / eight targeted suites pass, including 19 rule-patch cases, five added real-route creator editor cases, and prior joining/departure regressions. Full native and fixture TypeScript, Metro, 67 detail / 29 inherited service bindings, 22 fictional transport contracts and scoped diff checks pass. Browser verification used the actual route at 375 points: a title-only save retains custom ages 25–35; Circle editing shows its explanation and no ordinary size stepper.

## Next and limits

Creator editing still needs save/visit ownership, exact write receipts, unknown-result reconciliation, pending-exit protection, safe photo replacement, typed-versus-selected location correctness and its complete Afterglow presentation. Existing direct-save transport is not claimed fixed by this rule-patch package. A fresh positive backend receipt, physical-device verification and concurrency policy remain required. Ordinary waitlist/invitation work and other whole-app queue items remain. No SQL, production, real plan/membership/message, account or provider action occurred.
