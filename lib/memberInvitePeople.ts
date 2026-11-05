import { supabase } from './supabase';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import type { ProfileSearchResult } from './coCreatorInvites';
import { requestWithDeadline } from './requestWithDeadline';

export type MemberInvitePerson = ProfileSearchResult & {
  /** Supplied only by the existing accepted-People RPC, never a public profile. */
  handle: string | null;
  membership: 'active' | 'pending' | 'banned' | null;
};
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const check = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };

/** Read-only selection aid. The existing create/accept RPCs still authorize every invitation. */
export async function loadMemberInvitePeople(communityId: string, scope: CreatorPageScope): Promise<MemberInvitePerson[]> {
  check(scope);
  if (!uuid.test(communityId)) throw new Error('Couldn’t check this community.');
  const session = await requestWithDeadline(supabase.auth.getSession(), 8_000);
  check(scope);
  if (session.error) throw session.error;
  if (session.data.session?.user.id !== scope.userId || !session.data.session.access_token) throw new CreatorPageScopeExpired();
  const authorization = `Bearer ${session.data.session.access_token}`;
  const result = await requestWithDeadline(supabase.rpc('get_yours_grid', { p_user_id: scope.userId })
    .setHeader('Authorization', authorization), 12_000);
  check(scope);
  if (result.error) throw result.error;
  if (!Array.isArray(result.data) || result.data.some(row => !row || typeof row.user_id !== 'string' || !uuid.test(row.user_id)
    || !nullableText(row.first_name_display) || !nullableText(row.profile_photo_url) || !nullableText(row.handle))) {
    throw new Error('Couldn’t check your people.');
  }
  const people: MemberInvitePerson[] = Array.from(new Map(result.data.filter(row => row.user_id !== scope.userId).map(row => [row.user_id, {
    id: row.user_id, name: row.first_name_display?.trim() || row.handle?.trim() || 'WashedUp member',
    photo: row.profile_photo_url, handle: row.handle, membership: null,
  } satisfies MemberInvitePerson])).values());
  // Bound URL length and result count. Only inspect memberships for these already-connected people.
  for (let offset = 0; offset < people.length; offset += 100) {
    check(scope);
    const batch = people.slice(offset, offset + 100);
    const ids = new Set(batch.map(person => person.id));
    const members = await requestWithDeadline(supabase.from('community_members').select('user_id,status')
      .eq('community_id', communityId).in('user_id', [...ids]).in('status', ['active', 'pending', 'banned'])
      .setHeader('Authorization', authorization), 12_000);
    check(scope);
    if (members.error) throw members.error;
    if (!Array.isArray(members.data) || members.data.some(row => !row || !ids.has(row.user_id)
      || !['active', 'pending', 'banned'].includes(row.status))) throw new Error('Couldn’t check community membership.');
    const memberships = new Map(members.data.map(row => [row.user_id, row.status as MemberInvitePerson['membership']]));
    batch.forEach(person => { person.membership = memberships.get(person.id) ?? null; });
  }
  return people;
}
