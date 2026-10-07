import { supabase } from './supabase';

export interface TopicNotificationScope {
  topicId: string;
  userId: string;
  isCurrent: () => boolean;
}

async function checkAccount(scope: TopicNotificationScope) {
  if (!scope.isCurrent()) throw new Error('This chat changed.');
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!scope.isCurrent() || !user || user.id !== scope.userId) {
    throw new Error('Sign in again to check this setting.');
  }
}

/** The existing topic membership preference only. A missing row is unknown,
 * never an instruction to join or inherit another room's notification state. */
export async function getMyTopicMute(scope: TopicNotificationScope): Promise<boolean> {
  await checkAccount(scope);
  const { data, error } = await supabase.from('community_topic_members')
    .select('topic_id, user_id, notifications_on')
    .eq('topic_id', scope.topicId).eq('user_id', scope.userId).maybeSingle();
  if (!scope.isCurrent()) throw new Error('This chat changed.');
  if (error) throw error;
  if (data?.topic_id !== scope.topicId || data?.user_id !== scope.userId || typeof data?.notifications_on !== 'boolean') {
    throw new Error('Could not check this chat notification setting.');
  }
  return !data.notifications_on;
}

/** Same self-update as setTopicNotifications, bound to the original account
 * before and after its async identity read. Updates never create membership. */
export async function setMyTopicMute(scope: TopicNotificationScope, muted: boolean): Promise<void> {
  await checkAccount(scope);
  // checkAccount may settle just as navigation/auth changes. Recheck at the
  // mutation boundary and keep the original account in the SQL filter.
  if (!scope.isCurrent()) throw new Error('This chat changed.');
  const on = !muted;
  const { data, error } = await supabase.from('community_topic_members')
    .update({ notifications_on: on })
    .eq('topic_id', scope.topicId).eq('user_id', scope.userId)
    .select('topic_id, user_id, notifications_on').single();
  if (!scope.isCurrent()) throw new Error('This chat changed.');
  if (error) throw error;
  if (data?.topic_id !== scope.topicId || data?.user_id !== scope.userId || data?.notifications_on !== on) {
    throw new Error('Could not confirm this chat notification setting.');
  }
}
