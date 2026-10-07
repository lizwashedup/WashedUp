# Main community transport ownership — 2026-09-13

This local package adds an optional caller-owned account/visit scope to the existing main community transport in `lib/communityChat.ts`. It implements the internal auth/follow-up boundary identified in `main-community-lifetime-audit-2026-09-13.md`. Screen/component integration is separate work; an unscoped caller does not gain lifecycle protection automatically. No live transport, schema, provider, permission or authentication-flow changes were made.

## API

```ts
export interface CommunityOperationScope {
  readonly userId: string;
  readonly isCurrent: () => boolean;
}
export class ObsoleteCommunityOperationError extends Error;
export function isObsoleteCommunityOperation(error: unknown): error is ObsoleteCommunityOperationError;
```

The caller supplies the initiating account and a synchronous predicate for the exact room/account/epoch visit. Once a visit retires, its predicate must remain false, including A→B→A and admission lost→restored. The screen must still guard its own asynchronous UI completions and isolate its query keys.

All existing arguments and return shapes remain. The optional scope is the final argument:

| Helper | Signature |
| --- | --- |
| Main messages | `getCommunityBroadcasts(communityId, olderThan?, scope?)` |
| Main send | `sendCommunityMessage(communityId, body, imageUrl?, sendIdOverride?, scope?)` |
| Edit/delete | `editCommunityMessage(messageId, body, scope?)`; `deleteCommunityMessage(messageId, scope?)` |
| Reaction | `toggleBroadcastReaction(broadcastId, emoji, on, scope?)` |
| Main read marker | `markBroadcastsRead(communityId, scope?)` |
| Replies | `getBroadcastReplies(broadcastId, scope?)`; `sendBroadcastReply(broadcastId, body, scope?)` |
| Members/pinned event | `getCommunityChatMembers(communityId, scope?)`; `getPinnedCommunityEvent(communityId, scope?)` |
| Cards | `getCommunityChatPayload(scope?)` |

Cards also continue to accept the context supplied by existing direct React Query `queryFn` usage. A supplied scope takes precedence even if its object also has a `queryKey`. Other callers need no changes.

## Behavior

Scoped helpers check ownership before internal auth and request dispatch, after successful or rejected awaits, before further requests, and before returning account-specific results. Helpers which already read auth require its returned user to match the initiating scope; they cannot adopt a replacement account. Current auth errors remain errors. A retired result rejects with the exported obsolete-operation error, which carries no room/user/message data.

Main sends capture the initiating sender string once. Both the insert and the existing lost-response receipt lookup retain the same message UUID, community and sender. Retirement after an insert prevents the later receipt request. Retirement during a receipt request rejects its late success; the shared receipt helper cannot turn that retired result into a successful local send.

Main message enrichment stops before blocked-user checks, reaction/reply/profile reads, or result publication when its visit retires. Raw pagination identity and ordering remain unchanged, including the oldest raw cursor when that row is hidden by mutual blocking. Existing intro `kind`, IDs and payloads are preserved. Reply enrichment has equivalent auth/block/profile guards; its existing ascending order, 200-row limit, IDs and sender profiles remain.

Main read markers retain `community_broadcast_reads`, `community_id,user_id` conflict identity and their existing timestamp semantics. Edit/delete filters retain the original message ID, initiating sender and `kind='message'`. Reaction additions/removals preserve the provided storage key, including legacy `heart`, and the existing duplicate-key no-op behavior. This package does not change one-versus-multiple reaction policy or make two-step reaction replacement atomic.

## Reproduction and verification

Before implementation, all **13 initial service reproductions failed**: the send/edit/delete/reaction/read-marker helpers adopted B after delayed auth, retired calls still started requests, retired sends performed receipt lookup, and retired pages/block/enrichment/read-marker results continued or resolved. The later reply extension separately reproduced **3 failures** before its implementation: reply send adopted B, a retired primary reply page continued into enrichment, and delayed enrichment auth filtered as the replacement user.

The final targeted command uses only mocked Supabase, blocking checks and synthetic records:

```sh
./node_modules/.bin/jest --runInBand --ci --cacheDirectory=/private/tmp/washedup-main-scope-agent-jest lib/__tests__/communityOperationScope.test.ts lib/__tests__/topicSendReceipt.test.ts lib/__tests__/communityMutePreference.test.ts lib/__tests__/communityBlocks.test.ts lib/__tests__/communityChatUi.test.ts
```

**45 tests passed in 5 suites**, including **28 new service cases**. Positive checks preserve send UUID/receipt filters, truncation/body shape, main edit/delete filters, reaction keys, read-marker conflict keys, raw pagination, intro identity/payload, current blocked filtering, reply ordering/send fields and legacy direct query-function behavior. Deferred tests cover auth, insert/receipt, block/enrichment, read-marker, member/profile/pinned/card and reply boundaries.

```sh
./node_modules/.bin/tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-main-scope-agent.tsbuildinfo
git diff --check -- lib/communityChat.ts
```

The full TypeScript check passed for the initial transport package. During the companion reply integration, the full check reported only the two concurrent main-screen `scope` prop additions awaiting `CommunityMessageActions`/`BroadcastCard` Props updates; it reported no errors in this transport/test package. Root will record the combined check after those separate files are complete. The scoped diff check passed. Existing preserved dependencies were used, with caches/build info in `/private/tmp`; the root-owned dependency link remains intact.

## Limits

A scope is local lifetime ownership, not membership authorization. Existing RLS and server policies remain authoritative. The transport cannot cancel a request already dispatched, atomically bind Supabase token handling to an account across a remote write, retract a persisted message/read marker/reaction/reply, or claim notification delivery. An obsolete send might have committed and must be reconciled by an authorized later read; this package deliberately does not send another receipt request after retirement.

Scope-free callers retain their original behavior. Main membership/gate helpers live elsewhere and require caller guards. Topic/event helper interfaces, main mute contract, provider delivery, shared receipt semantics and backend schema were not changed. The shared sender-profile helper accepts the new optional scope for replies; its unscoped topic callers keep the same source reads and filtering. No native-device or production verification is claimed.

## Final integration result

After all companion and screen edits were frozen, the coordinated main-community package passed 130 tests in 11 suites. The root full-repository noEmit TypeScript check and scoped diff check also passed. Earlier references to in-flight missing props or shadowed names above are historical check results, not remaining compile errors. Physical-device and production boundaries remain unchanged.
