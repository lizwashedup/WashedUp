# Community rooms: preservation and implementation contract

September 12, 2026. This package adds a local rehearsal validator and defines the next server/client transition. It does not provision rooms, run SQL, publish an app, copy production records or establish that a production migration has passed.

## What members should experience

The Chats list has one community entry. Opening it shows Intros, the main conversation, and creator-made optional groups. Intros and main are included with active community membership; members can mute either. Optional groups can be joined and left. Display names are editable, but room identities and roles are stable.

An event someone has joined stays a separate conversation in the outer inbox. A community shortcut opens that same event topic. Attending an event does not join the community. Event history, unread counts, notification preference and the end-time-first 48-hour lifecycle stay independent.

Private joining answers remain private. New introductions must be deliberately written by the member for other members, with clear public-audience wording before submission. Request-to-join remains conditional on the creator's setting; admission, Ghost eligibility and existing Plan/event say-hello gates are separate rules and must not be weakened.

## What the saved source actually stores

| Source | Present behavior | Preservation decision |
| --- | --- | --- |
| `community_broadcasts`, `kind='intro'` | Existing public introduction cards, with structured payload, original body, author and timestamp. The saved approval RPC composes these from the explicitly named `intro_answer`. | Retain existing public rows and their IDs. Do not recompose old records as new member-authored messages or post them again. |
| Same table, `kind='message'` or `'broadcast'` | Member conversation and creator announcements share the main history. | Preserve this conversation and its existing name. It cannot simply be renamed Intros. |
| `community_broadcast_replies` / `community_broadcast_reactions` | Both depend on original broadcast IDs. Multiple emoji per member are permitted by the legacy broadcast key. | Original references, ordering and reaction keys remain. Moving/copying root messages would break this contract. |
| `community_topics` / messages / memberships | Separate creator rooms and event rooms. Event provenance is `explore_event_id`; a default flag or a name is insufficient. | Each topic keeps its ID, membership, notification flag, history, media, replies and reactions. Preserve archived rooms as archived. |
| `community_broadcast_reads` | One community/user timestamp currently covers the mixed stream. | A future split needs separate read tracking without acknowledging another room or marking old unread history read at migration time. |
| `community_member_answers` / older `community_members.join_answers` | Private admission data. Extra configured answers are separate from the public introduction field. | Never use these tables as the Intros message source, preview, push payload or export for ordinary members. Preserve storage/access. |

Source anchors: [kinds and structured public intro](/Users/liz/Desktop/WashedUp/Implementation/chat-context-slice/lib/communityChat.ts:310), [current mixed-history pagination](/Users/liz/Desktop/WashedUp/Implementation/chat-context-slice/lib/communityChat.ts:382), [saved approval behavior](/Users/liz/Desktop/WashedUp/Implementation/chat-context-slice/supabase/migrations/20260707200000_intro_blurb.sql:239), [private additional questions](/Users/liz/Desktop/WashedUp/Implementation/chat-context-slice/components/communities/JoinCommunityPopup.tsx:201), [topic reaction identity](/Users/liz/Desktop/WashedUp/Implementation/chat-context-slice/supabase/migrations/20260828200000_community_topic_chat_parity_phase1.sql:119).

These are saved definitions, not a fresh inspection of the deployed database. Some later comments still refer to an obsolete introductions topic; comments do not override the actual function bodies or Liz's current decisions.

## Recommended transition, in stages

1. **Inventory a database copy.** Export complete rows and actual column metadata for the affected community in one consistent snapshot, including archived/event topics and all dependent history/preferences. Capture exact deployed RPC/RLS/trigger definitions separately. Do not use a paginated inbox response as a complete inventory. Work on a copy with background notification jobs disabled.
2. **Assign stable presentation roles explicitly.** Define room identity, role, display name and one existing history source per room. The minimum safe draft uses disjoint `kind='intro'` and `kind IN ('message','broadcast')` views over unchanged broadcast rows. Existing topics remain their own rooms. Server filtering must happen before pagination, using stable `(created_at,id)` cursors. A client filter after `LIMIT` can create empty pages and missing history.
3. **Resolve existing main-room ambiguity from actual IDs.** If a community has both a mixed main stream and an After Glow topic, matching names do not justify a merge or deleting either room. Keep both histories accessible. Record which existing topic/stream becomes main and the retained presentation of the other before cutover. The local sample does not select Sunset Club's production topic by name. No message copy, role-by-name heuristic, silent subscription or room-ID reuse is permitted.
4. **Add server-supported room roles and preferences.** Intros/main inclusion follows active community membership, without changing community-member IDs, joining answers, admission settings or creator approval. New public introduction writes require an explicit room identity and member authorship. Creator rename changes only the display name. Existing optional-topic membership and event-attendee membership stay independent. Restore optional-group creation deliberately; the current `createTopic()` guard still rejects it.
5. **Add independent read positions with an explicit compatibility boundary.** Seed both broadcast-derived views from the existing community/user read timestamp (or its existing joined-at fallback) without advancing it. After cutover, reading Intros advances only Intros; reading main advances only main. A legacy client can still write the shared marker, so the new readers must not keep taking `max(old,new)` after seeding. Verify old-client behavior on a database copy before selecting rollout/version gating. Opening the directory never marks its children read.
6. **Integrate source-aware notifications and mute.** Use the [mute contract](community-mute-contract-2026-09-12.md). Parent mute is a separate persistent-chat override and preserves individual flags. Messages suppressed while muted do not become replayable on unmute. Event-topic notifications retain their own setting. Confirm preferences at fanout and before each send/retry. Reactions must resolve the original message author and source; the current renderer alone does not provide notifications.
7. **Rehearse and review native behavior.** Verify old/new clients, stable message identity, direct links, late sends, reconnect, pagination, deleted/blocked senders, mentions, removed membership, Ghost access, archived rooms, unread/notification routing and rollback. Only then enable the existing development-only grouped directory for device review and prepare a release package.

For new communities there is no historical ambiguity: provision Intros and main atomically with their stable roles, while respecting the page's application/admission states. Provisioning must be idempotent on retry. Pending/declined applicants and event-only attendees receive neither persistent room merely because a client renders a directory.

## Runnable local preservation check

Files: [rehearsal.mjs](/Users/liz/Desktop/WashedUp/Implementation/chat-context-slice/scripts/community-rooms/rehearsal.mjs), [synthetic tests](/Users/liz/Desktop/WashedUp/Implementation/chat-context-slice/scripts/community-rooms/rehearsal.test.mjs).

Run from the isolated native checkout:

```sh
node --test scripts/community-rooms/rehearsal.test.mjs
node scripts/community-rooms/rehearsal.mjs /absolute/path/to/local-rehearsal.json
```

Input is `{snapshotComplete, snapshotId, communityId, schema, manifest, before, after}`. `schema` has `version:1` and `columns` for all protected tables, obtained from the snapshot's actual database metadata. Both snapshots contain complete row arrays for every protected table, including empty tables. The schema must include the checker's versioned minimum columns; every row must include every declared column. Keep full private snapshots outside git and do not paste them into logs or messages.

`manifest` has `version:1`, `inventoryComplete:true`, `communityId`, `sources` and `rooms`. A source is `{kind,id,communityId,eventId,archived}`; kinds are `broadcast-intros`, `broadcast-main`, `topic`. Broadcast source IDs equal the community ID. A room is `{id,role,name,sources:[{kind,id}]}`; roles are `intros`, `main`, `optional`, `legacy`. Every persistent source maps exactly once; event sources remain inventoried but outside persistent-room assignments. The two broadcast partitions must be represented even when empty. An archived topic may only use retention role `legacy`. New runtime role metadata is not written by this checker.

The checker verifies mapping against the topic inventory, source relationships, actual primary/unique keys, complete declared column sets and unchanged legacy rows using canonical hashes. It rejects identity-only exports, changed/deleted/added legacy rows, cross-community/orphan history, unassigned/duplicated history, history merges, event promotion and reopening archived topics. Diagnostics contain table names, codes and counts, never bodies, private answers, user IDs or hashes.

The CLI exits `0` for a passing local rehearsal, `1` for contract failures and `2` for unreadable/malformed input. It performs no network calls or database writes. Synthetic tests pass locally; they are not a production preservation result.

## Limits of this checkpoint

This first checker covers **additive routing over unchanged legacy records**. It intentionally rejects new subscriptions or old-row updates. Later planned provisioning/read-position changes need their own explicit assertions over new metadata and authorization tests, rather than a blanket allow-list weakening preservation. Completeness is an exporter assertion plus schema/relationship validation; the script cannot independently prove that an unseen database row was included. It is not a SQL constraint engine, RLS/security proof, notification test, device test or release approval.

No database-copy export, live user data comparison, real delivery test, native visual update or Figma publication occurred in this checkpoint. The native grouping feature remains development-only/off by default until the transition and device checks are ready.
