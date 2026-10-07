# Main community conversation lifetime audit

Read-only inspection of the isolated `chat-context-slice` source on September 13. This identifies code paths to repair; it is not evidence that these races happened in production. No implementation, schema, provider or live records were changed during this audit.

Subsequent implementation is tracked in `main-community-lifetime-repair-2026-09-13.md`. The line references below describe the audited snapshot, before that repair.

The main stream does **not** yet inherit the topic stream's lifetime guarantees. It observes the signed-in account, but only consumes the ID for entry controls/photo selection and passes the full observer to the mute controller. Main message queries and mutations remain independent of that observer. Its existing main mute preference is already account-scoped; do not replace or weaken it.

## Prioritized findings

### 1. A confirmed send can erase a newer draft or reset another visit's state

Source: `app/community-thread/[id].tsx:94`, `:108`, `:238`, `:249`, `:338`, `:359`, `:397`.

Text/edit success unconditionally clears `draft`, `draftRef`, editing and mentions. Photo success does the same. `finally` unconditionally changes the busy flag. The draft remains editable during the send, so typing a second message before the first receipt resolves loses that second draft. There is no reset keyed to room/account/epoch, so route/account changes retain the old draft, pending photo, menus and send sessions; late failures can appear in the new visit. Merely capturing the current room ID in the callback does not protect component state.

Smallest repair: an entry visit keyed by room, observed viewer ID and observer epoch; `viewer.isCurrent()` inside its current check; a draft revision incremented by input, edit, cancel and mention changes; clear only the submitted revision in the current visit. Reset the local entry state once per visit and retire callbacks on cleanup. This is the pattern already implemented in `app/community-topic/[id].tsx:274`, `:309`, `:374`, `:570`, `:686`.

### 2. Shared query keys can display another account's cached data; the service can adopt a new account mid-operation

Source: main screen `:135`, `:144`, `:150`, `:167`, `:192`, `:202`; `lib/communityChat.ts:382`, `:437`, `:458`, `:480`, `:492`, `:504`; `hooks/useObservedUser.ts:19`, `:29`, `:59`.

The keys currently omit the viewer: `['community-my-membership', id]`, `['community-chat-cards']`, `['community-chat-members', id]`, `['community-broadcasts', id]`, plus pinned event and empty-thread gate. These fetches are enabled before identity is known. Returned messages include account-specific blocked filtering and reaction `mine` values. A second account observing the same query can receive the first account's cached page/membership immediately; a render caused by identity change does not itself change the query key. The shared QueryClient is created at `lib/queryClient.ts:8`; the inspected app auth handler does not clear these queries.

Mutation helpers independently await `supabase.auth.getUser()`. A retained old callback or photo pipeline can therefore submit old-room content as whichever user that later read returns. In a two-step reaction replacement, removal and insertion each resolve the current user separately. RLS remains authoritative, but when both accounts can access the community it cannot know that the new account did not initiate the old UI intent. The main receipt lookup already filters UUID, community and sender correctly; that protection must remain.

Smallest repair: add viewer/epoch to the screen-owned query keys, disable reads while identity is unresolved or errored, check the captured observer/abort signal before accepting async query results, and invalidate by the same scoped keys. Give the touched message/read-marker helpers an additive operation context or a scoped adapter that captures the initiating viewer and checks current ownership after the internal auth await and before each next request. A UI-only check before calling a helper is insufficient to close its internal `getUser()` gap. Keep existing call sites compatible and keep server permission checks.

Reference: `hooks/useCommunityBroadcastMute.ts:15` through `:49` already combines scoped query keys with the observer's synchronous guard. `hooks/useTopicChat.ts:74`, `:105`, `:292`, `:349` capture viewer/epoch and reject obsolete transport completions, including receipt lookups.

### 3. Removed/banned membership does not retire pending attachment work or stored actions

Source: main screen `:141`, `:181`, `:282`, `:322`, `:338`, `:374`, `:640`, `:730`, `:745`, `:750`, `:780`.

A confirmed removed/banned state hides the composer and closes the separate photo viewer, but not the photo-preview/location picker or stored message menus. The photo permission/preparation/upload chain has no current-membership check after any await; its final send can continue. A retained location callback sees the removed flag from its old render. Own/member menu actions, reaction selection and queued input callbacks have no lifetime check. The message list itself remains rendered; the present tests only assert the composer disappears, so do not describe them as proving removal revokes all cached content.

Smallest repair: a separate attachment/admission visit which is retired when confirmed access is lost and is never revived by access reopening; check it after permission, picker, manipulation and upload. Close pending overlays and invalidate their stored callbacks. Wrap mutation/menu/input callbacks in the entry/admission guard. Keep unknown membership handling an explicit separate product/security decision: the current code deliberately defers a failed/unknown membership read to RLS, so do not silently change that contract during this bounded repair. Do not add a new first-message gate to the main room.

Reference: topic `:297` through `:308`, `:490` through `:567`; its attachment visit handles an allowed → disallowed → allowed cycle without reviving the original work. Its photo-viewer revocation is a different concern from attachment upload ownership.

### 4. State flags do not provide synchronous single-flight ownership

Source: main screen `:239`, `:259`, `:305`, `:323`, `:340`, `:370`, `:374`; `lib/textSendSession.ts:7`, `lib/photoSendSession.ts:8`.

Calling the same retained send callback twice before React rerenders sees `sending === false` twice. Photo picking has no permission/picker lock; uploading uses the same delayed state guard. Identical text calls initially reuse a UUID, which reduces duplicates, but does not prevent competing requests/finalizers or preserve the next attempt's session. With concurrent photo attempts, the first completed attempt can `session.clear()` before the second obtains its send ID, allowing another UUID for the same photo. Reactions have neither a per-message lock nor a current check between removing the previous emoji and inserting the next, so concurrent choices can leave multiple own rows in this table.

Smallest repair: ref-owned attempt tokens for text, photo preparation/upload and native picker launch; per-message reaction serialization. Release a lock only when the finishing operation still owns it and its visit. Give sessions one visit/attempt owner while preserving retry UUIDs and remembered successful uploads for unchanged failed sends. A late success or failure must not clear the current visit's sessions or busy state. No table change is needed.

### 5. Read markers and realtime refresh are tied to room ID, not the active viewer/visit

Source: main screen `:208` through `:234`; `lib/communityChat.ts:285`. Topic's screen-level `markTopicRead` effect at `app/community-topic/[id].tsx:364` has the same remaining ownership weakness; it should not be copied as the desired model.

The main subscription survives account changes in the same mounted room; it writes a read marker immediately and on every broadcast callback using a helper that resolves the current account later. There is no active/observer check in the callback or continuation. This can mark the old room read for the next account, and cleanup/late completion invalidates shared lists. React Query's key alone cannot protect this write.

Smallest repair: scope the effect to the active observed viewer/epoch, subscribe only when identity is ready, retire callbacks before unsubscribe, and guard the read-marker helper after its auth await. Retain the existing read-marker table and original community ID. Continue using broad list-prefix invalidation only where intentionally refreshing all list variants; it must not be mistaken for message cache isolation.

Related later work: this screen subscribes only to `community_broadcasts`; changes to `community_broadcast_reactions` do not independently refresh another member's reaction display. That is a separate realtime coverage gap, not proof of a send/receipt failure.

## Existing test scaffolds and missing reproductions

Five current suites passed: **76 tests**, no live calls. They establish the existing topic protections and main UI baseline; they do not establish the absent main lifetime checks.

| Existing file | Reuse / new main assertion |
| --- | --- |
| `components/chat/__tests__/CommunityTopicEntryLifetime.test.tsx:107` | Deferred send resolves after typing a new draft: new draft remains. Repeat for edit and photo caption completion. |
| Same file `:114`, `:124`, `:223` | Room A → B and account A → B → A; stale success/failure/input/selection/mention callbacks cannot clear or change new state. New visit can send immediately without old `finally` releasing its lock. |
| Same file `:132`, `:140`, `:158`, `:251` | Resolve photo permission, manipulation or upload after room/account change, removal or removal/reinstatement. No next stage, no reopened picker, no retained preview. |
| Same file `:190`, `:204`, `:276` | Invoke identical retained text/photo/picker callbacks twice before rerender; exactly one pipeline and one owning finalizer. |
| `hooks/__tests__/useTopicChat.mutations.test.tsx:115`, `:128`, `:138`, `:162`, `:173`, `:230`, `:243`, `:270` | Service-level ownership: no second reaction operation/read marker/receipt lookup after identity changes, including before React commits; preserve exact UUID/community/sender filters. |
| `components/chat/__tests__/CommunityChatPhotos.test.tsx` | Reuse actual main screen with mocked modal and mutation services. Preserve original message IDs, chronology, intro-card payloads, report/block/edit paths and viewer revocation. Add stored menu/cancel/location callbacks after account/removal transitions. |
| `components/chat/__tests__/CommunityMainHeader.test.tsx:83`, `:105` | Preserve removed composer and offline draft behavior, original named main room, pinned event navigation and flag-off presentation. Its current removed case has an empty message fixture and cannot test cached-content visibility. |
| `lib/__tests__/topicSendReceipt.test.ts`, `lib/__tests__/textSendSession.test.ts` | Retain lost-response recovery and unchanged-draft retry identity. Main service tests should check caller ownership around the auth await and the receipt lookup—not merely the generic helper. |

Add a **real QueryClientProvider** test for account-isolated main query caches. Existing screen tests mock `useQuery`/`useInfiniteQuery` by the first key element and therefore cannot detect a missing viewer in the actual key. Seed account A's page and membership, switch to B before B's read resolves, and assert A's content/`mine` values never become B's displayed data. Also resolve A's old read after A → B → A and ensure it cannot populate the new visit.

## Bounded implementation package

Repair the main screen's entry ownership and scoped queries first, with a small optional scope contract for only the touched helpers in `lib/communityChat.ts` where transport can cross an internal await. Add focused main lifecycle and service/cache tests using the scaffolds above. Do not reimplement the paginated stream or migrate to a new chat provider as part of this fix.

Preserve `community_broadcasts`, message/intro IDs, `kind`/`payload`, chronological pagination and existing send-receipt UUID filters. Preserve community approval, first-intro data, existing gate behavior, photo and location payload formats, mute semantics, original callback destinations and the development flag. No production or migration work is implied by this audit.
