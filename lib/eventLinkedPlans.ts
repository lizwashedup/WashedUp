import {supabase} from './supabase';
import type {PageImageScope} from './publishedPageCover';

export interface LinkedEventPlan {
  id: string; title: string; start_time: string; location_text: string | null;
  member_count: number; max_invites: number; status: string; creator_user_id: string;
  creator_name: string | null; creator_photo: string | null; primary_vibe: string | null;
}
export async function readEventLinkedPlans(eventId: string, scope: PageImageScope): Promise<{plans: LinkedEventPlan[]; counts: Record<string, number>}> {
  const current = () => { if (!scope.isCurrent()) throw Error('This event visit changed.'); };
  current();
  const session = await supabase.auth.getSession(); current();
  if (session.error) throw session.error;
  if ((session.data.session?.user.id ?? null) !== scope.userId) throw Error('Your account changed.');
  const authorization = session.data.session?.access_token;
  if (scope.userId && !authorization) throw Error('Your account could not be checked.');
  let request = supabase.from('events').select('id,title,start_time,location_text,member_count,max_invites,status,creator_user_id,primary_vibe')
    .eq('explore_event_id', eventId).in('status', ['forming', 'active', 'full']).order('start_time', {ascending:true});
  if (authorization) request = request.setHeader('Authorization', `Bearer ${authorization}`);
  const result = await request; current();
  if (result.error) throw result.error;
  if (!Array.isArray(result.data)) throw Error('Plans could not be checked.');
  const plans: LinkedEventPlan[] = result.data.map((p: any) => ({...p, creator_name:null, creator_photo:null}));
  if (!plans.length) return {plans, counts:{}};
  let countRequest = supabase.rpc('get_event_joined_counts', {p_event_ids:plans.map(p=>p.id)});
  if (authorization) countRequest = countRequest.setHeader('Authorization', `Bearer ${authorization}`);
  const resultCounts = await countRequest; current();
  if (resultCounts.error) throw resultCounts.error;
  if (!Array.isArray(resultCounts.data)) throw Error('Plan availability could not be checked.');
  const counts: Record<string,number> = {};
  for (const row of resultCounts.data) {
    if (!plans.some(p=>p.id===row.event_id) || Object.prototype.hasOwnProperty.call(counts,row.event_id)
      || !Number.isSafeInteger(row.joined_count) || row.joined_count < 0) throw Error('Plan availability could not be checked.');
    counts[row.event_id] = row.joined_count;
  }
  if (plans.some(p=>counts[p.id]===undefined)) throw Error('Plan availability could not be checked.');
  const creatorIds = [...new Set(plans.map(p=>p.creator_user_id).filter(Boolean))];
  if (creatorIds.length) {
    let profileRequest = supabase.from('profiles_public').select('id,first_name_display,profile_photo_url').in('id',creatorIds);
    if (authorization) profileRequest = profileRequest.setHeader('Authorization', `Bearer ${authorization}`);
    const profiles = await profileRequest; current();
    if (profiles.error) throw profiles.error;
    if (!Array.isArray(profiles.data)) throw Error('Plan creators could not be checked.');
    for (const plan of plans) {
      const creator = profiles.data.find((p:any)=>p.id===plan.creator_user_id);
      plan.creator_name = creator?.first_name_display ?? null;
      plan.creator_photo = creator?.profile_photo_url ?? null;
    }
  }
  return {plans, counts};
}
