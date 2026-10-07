import {
  getCommunityBroadcasts, getTopicMessages, ObsoleteCommunityOperationError,
  type CommunityOperationScope, type CommunityMessageReadOptions,
} from './communityChat';
import { getCommunityRoomHistory, type CommunityRoomCursor, type CommunityRoomMessage } from './communityRoomHistory';
import { chronologicalCommunityRoomItems, compareCommunityRoomSequence, type RoomSequence } from './communityRoomWindow';

export type CommunityMessageAnchor = { id: string; source: 'broadcast' | 'topic' };
export type CommunityAnchorRoom =
  | { kind: 'main'; communityId: string; mapped: boolean }
  | { kind: 'topic'; topicId: string }
  | { kind: 'intros'; communityId: string; topicId: string };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function parseCommunityMessageAnchor(id: unknown, source: unknown): CommunityMessageAnchor | null {
  return uuid(id) && (source === 'broadcast' || source === 'topic') ? { id: id.toLowerCase(), source } : null;
}
export class CommunityMessageUnavailableError extends Error {
  constructor() { super('This message is no longer available.'); this.name = 'CommunityMessageUnavailableError'; }
}
function current(scope: CommunityOperationScope) {
  if (!scope.userId || !scope.isCurrent()) throw new ObsoleteCommunityOperationError();
}
const sequence = (item: CommunityRoomMessage): RoomSequence => ({ id: item.message.id, created_at: item.message.created_at, source: item.source });

/** An exact source lookup plus a bounded context window. Never append a distant
 * target to the newest page: that would hide a gap in conversation history. */
export async function getCommunityMessageAnchorWindow(
  room: CommunityAnchorRoom, anchor: CommunityMessageAnchor, scope: CommunityOperationScope,
) {
  current(scope);
  if (!parseCommunityMessageAnchor(anchor.id, anchor.source) ||
    (room.kind !== 'topic' && !uuid(room.communityId)) || (room.kind !== 'main' && !uuid(room.topicId)) ||
    (room.kind === 'main' && anchor.source !== 'broadcast') || (room.kind === 'topic' && anchor.source !== 'topic')) {
    throw new CommunityMessageUnavailableError();
  }
  const broadcastKind: CommunityMessageReadOptions['broadcastKind'] = room.kind === 'intros' ? 'intro' : room.kind === 'main' && room.mapped ? 'main' : undefined;
  const exactOptions: CommunityMessageReadOptions = { messageIds: [anchor.id], strictEnrichment: true, resolveReplyParents: true, broadcastKind };
  const readTarget = () => anchor.source === 'broadcast'
    ? getCommunityBroadcasts((room as Exclude<CommunityAnchorRoom, { kind: 'topic' }>).communityId, undefined, scope, exactOptions)
    : getTopicMessages((room as Exclude<CommunityAnchorRoom, { kind: 'main' }>).topicId, undefined, scope, exactOptions);
  const exact = await readTarget();
  current(scope);
  const targetMessage = exact.messages.find(message => message.id === anchor.id);
  if (!targetMessage) throw new CommunityMessageUnavailableError();
  if (anchor.source === 'broadcast' && broadcastKind &&
    (broadcastKind === 'intro') !== ('kind' in targetMessage && targetMessage.kind === 'intro')) throw new CommunityMessageUnavailableError();
  const target = { key: `${anchor.source}:${anchor.id}`, source: anchor.source, message: targetMessage } as CommunityRoomMessage;
  const targetCursor = sequence(target);
  const coreCursor: CommunityRoomCursor | undefined = room.kind === 'intros' || room.kind === 'main' && room.mapped
    ? { ...targetCursor, communityId: room.communityId, role: room.kind === 'intros' ? 'intros' : 'main' } : undefined;
  const before = coreCursor
    ? await getCommunityRoomHistory(coreCursor.communityId, coreCursor.role, scope, coreCursor)
    : room.kind === 'main'
      ? await getCommunityBroadcasts(room.communityId, targetCursor, scope, { strictEnrichment: true })
        .then(page => ({ ...page, messages: page.messages.map(message => ({ key: `broadcast:${message.id}`, source: 'broadcast' as const, message })) }))
      : await getTopicMessages(room.topicId, targetCursor, scope, { strictEnrichment: true, resolveReplyParents: true })
        .then(page => ({ ...page, messages: page.messages.map(message => ({ key: `topic:${message.id}`, source: 'topic' as const, message })) }));
  current(scope);
  const sources = room.kind === 'intros' ? ['broadcast', 'topic'] as const : [anchor.source];
  const afterPages = [];
  for (const source of sources) {
    current(scope);
    const after: NonNullable<CommunityMessageReadOptions['after']> = {
      cursor: targetCursor,
      sameTime: source === anchor.source ? undefined : source > anchor.source ? 'all' : 'none',
    };
    const options: CommunityMessageReadOptions = { after, strictEnrichment: true, resolveReplyParents: true, broadcastKind };
    const page = source === 'broadcast'
      ? await getCommunityBroadcasts((room as Exclude<CommunityAnchorRoom, { kind: 'topic' }>).communityId, undefined, scope, options)
      : await getTopicMessages((room as Exclude<CommunityAnchorRoom, { kind: 'main' }>).topicId, undefined, scope, options);
    afterPages.push({ ...page, source });
  }
  current(scope);
  // A full source page may stop before the other source. Its raw boundary is
  // the safe combined end, even if blocked/deleted rows made it look empty.
  const boundaries = afterPages.filter(page => page.hasMore && page.olderCursor)
    .map(page => ({ ...page.olderCursor!, source: page.source })).sort(compareCommunityRoomSequence);
  const end = boundaries[0];
  const afterItems = afterPages.flatMap(page => page.messages.map(message =>
    ({ key: `${page.source}:${message.id}`, source: page.source, message }) as CommunityRoomMessage))
    .filter(item => compareCommunityRoomSequence(sequence(item), targetCursor) > 0 &&
      (!end || compareCommunityRoomSequence(sequence(item), end) <= 0));
  // Context reads can outlive the source. Recheck its current access/kind before
  // exposing a cached target that was deleted or moved while this window loaded.
  const checked = (await readTarget()).messages.find(message => message.id === anchor.id);
  current(scope);
  if (!checked || checked.created_at !== targetMessage.created_at || anchor.source === 'broadcast' && broadcastKind &&
    (broadcastKind === 'intro') !== ('kind' in checked && checked.kind === 'intro')) throw new CommunityMessageUnavailableError();
  const checkedTarget = { ...target, message: checked } as CommunityRoomMessage;
  return {
    messages: chronologicalCommunityRoomItems([...before.messages, checkedTarget, ...afterItems]),
    hasMore: before.hasMore, olderCursor: before.olderCursor,
    hasNewer: afterPages.some(page => page.hasMore), targetKey: target.key,
  };
}
