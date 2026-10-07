# Category and mention rollback boundary — review only

An application rollback must retain the additive categories/mention_data columns, identity/category guards and durable attempt tables. Do not use a pre-update backup or destructive down migration to erase writes made after enablement. Existing messages, selected-person identities, secondary categories and exact request receipts are part of current user data.

The isolated September21 managed-schema and committed-write rehearsal verifies the current category/mention overlay plus event_category_legacy_continuity correction. The latter preserves older primary-category receipt values while reconciling the newer list; current clients normalize the required Community tag. Old text edits clear only mention identities invalidated by that edit. Existing reply-edit refusal, policies, grants and financial/storage data remain unchanged.

Under any later separately authorized rollout, capture a current consistent recovery point, preserve an inventory of active writers/workers and exact migration hashes, and prefer reverting the application while leaving compatible additive data/guards in place. Do not promote the review SQL or these local synthetic databases as part of this documentation step. Verify the actual previous client and provider/queue behavior before selecting a release rollback target.

Evidence: /Users/liz/Desktop/WashedUp/Implementation/backend-recovery-2026-09-14/member-review-corrections/postwrite-legacy-continuity-20260921/VERIFICATION.md. Current result covers13 protocol assertions, a committed post-write backup restore and2920 original rows preserved. It does not close full migration/device/provider/release acceptance. Production and saved integration are unchanged; build/sign/install hold remains.
