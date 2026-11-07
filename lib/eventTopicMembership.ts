import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import type { CommunityOperationScope } from './communityChat';

/** Own topic row is readable under the existing self-select policy even when
 * attendance no longer grants the surrounding event chat. This checks sending
 * membership only; a parent-community member may still legitimately read. */
export async function getMyEventTopicMembership(topicId: string, owner: CommunityOperationScope): Promise<boolean> {
  let active = true;
  const requireCurrent = () => {
    if (!active || !topicId || !owner.userId || !owner.isCurrent()) throw Error('This chat visit changed.');
  };
  try {
    return await requestWithDeadline((async () => {
      requireCurrent();
      const session = await supabase.auth.getSession();
      requireCurrent();
      if (session.error) throw session.error;
      if (session.data.session?.user.id !== owner.userId || !session.data.session.access_token) throw Error('This account changed.');
      const { data, error } = await supabase.from('community_topic_members')
        .select('topic_id,user_id').eq('topic_id', topicId).eq('user_id', owner.userId)
        .maybeSingle().setHeader('Authorization', `Bearer ${session.data.session.access_token}`);
      requireCurrent();
      if (error) throw error;
      if (data === null) return false;
      if (data?.topic_id !== topicId || data?.user_id !== owner.userId) throw Error('Could not check your event chat membership.');
      return true;
    })(), 12_000);
  } finally { active = false; }
}
