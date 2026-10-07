import { supabase } from './supabase';
import { ObsoleteCommunityOperationError, type CommunityChatRowData, type CommunityOperationScope } from './communityChat';
import { communityMessagePreview } from './communityLocationMessage';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const fail = (): never => { throw Error('These community chats could not be confirmed. Try again.'); };
async function account(scope: CommunityOperationScope) {
  if (!scope.isCurrent()) throw new ObsoleteCommunityOperationError();
  const { data, error } = await supabase.auth.getUser();
  if (!scope.isCurrent() || data.user?.id !== scope.userId) throw new ObsoleteCommunityOperationError();
  if (error) throw error;
}
/** Overlay exact joined mapped rooms on existing authorized cover/event rows.
 * Failed summaries never fall back to combined counts or create read markers. */
export async function getCommunityRoomInboxRows(rows: readonly CommunityChatRowData[], scope: CommunityOperationScope): Promise<CommunityChatRowData[]> {
  await account(scope);
  const { data, error } = await supabase.rpc('get_my_community_room_summaries');
  await account(scope);
  if (error) throw error;
  if (!Array.isArray(data)) fail();
  const replacements = new Map<string, CommunityChatRowData[]>();
  const eventProvenance = new Map<string, string>();
  for (const page of data as any[]) {
    if (!page || !uuid(page.community_id) || replacements.has(page.community_id) || !text(page.name)
      || !Array.isArray(page.rooms) || page.rooms.length < 2 || !Array.isArray(page.event_topics)) fail();
    const base = rows.find(row => row.kind === 'community' && row.communityId === page.community_id && row.targetId === page.community_id);
    if (!base) return fail();
    const identities = new Set<string>();
    const mapped = page.rooms.map((room: any, index: number): CommunityChatRowData => {
      if (!room || !uuid(room.id) || !text(room.name) || room.joined !== true || typeof room.notifications_on !== 'boolean'
        || !Number.isSafeInteger(room.unread) || room.unread < 0 || !(room.joined_at === null || timestamp(room.joined_at))
        || (index === 0 ? room.role !== 'intros' || room.storage !== 'topic' || room.included !== true
          : index === 1 ? room.role !== 'main' || room.storage !== 'broadcast' || room.included !== true || room.id !== page.community_id
            : room.role !== 'optional' || room.storage !== 'topic' || room.included !== false)
        || identities.has(`${room.storage}:${room.id}`)) fail();
      identities.add(`${room.storage}:${room.id}`);
      const latest = room.latest;
      if (latest !== null && (!latest || !uuid(latest.id) || !timestamp(latest.created_at) || typeof latest.body !== 'string'
        || typeof latest.has_image !== 'boolean' || typeof latest.has_location !== 'boolean'
        || (room.role === 'main' ? latest.source !== 'broadcast' : room.role === 'optional' ? latest.source !== 'topic' : !['broadcast', 'topic'].includes(latest.source)))) fail();
      const main = room.role === 'main';
      const source = main ? base : rows.find(row => row.kind === 'room' && row.targetId === room.id && row.communityId === page.community_id);
      if (source?.eventId) fail();
      const preview = latest ? latest.has_location ? 'Shared a location' : latest.body.trim()
        ? communityMessagePreview(latest.body) : latest.has_image ? 'Shared a photo' : 'Message' : 'Say hello.';
      return {
        ...(source ?? base), key: main ? base.key : `room-${room.id}`, kind: main ? 'community' : 'room',
        targetId: room.id, communityId: page.community_id, title: main ? page.name : room.name,
        secondary: main ? null : page.name, roomName: room.name, roomRole: room.role, roomNotificationsOn: room.notifications_on,
        preview, lastAt: latest?.created_at ?? room.joined_at, unread: room.unread, eventId: null, isDefault: room.role === 'intros',
        lastMessageId: latest?.id ?? null, lastMessageSource: latest?.source ?? null,
      };
    });
    for (const event of page.event_topics) {
      if (!event || !uuid(event.id) || !uuid(event.event_id) || identities.has(`topic:${event.id}`) || eventProvenance.has(event.id)) fail();
      eventProvenance.set(event.id, event.event_id);
    }
    replacements.set(page.community_id, mapped);
  }
  const result: CommunityChatRowData[] = [];
  for (const row of rows) {
    if (!replacements.has(row.communityId)) { result.push(row); continue; }
    if (row.kind !== 'room') continue;
    const eventId = eventProvenance.get(row.targetId);
    if (eventId) result.push({ ...row, eventId });
    else if (row.eventId) result.push(row); // Existing authorized event path stays separate.
    // Persistent rows come only from the current joined-room summary below.
  }
  for (const mapped of replacements.values()) result.push(...mapped);
  return result;
}
