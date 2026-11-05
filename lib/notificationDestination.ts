import { communityJoinPushRoute } from './communityJoinNotification';
import { communityChatPushRoute } from './communityChatPushRoute';
import { memberReactionPushRoute } from './memberReactionPushRoute';
import { pageInvitationPushRoute } from './pageInvitationNotification';
import { attendeeMessagePushRoute } from './attendeeMessageNotification';
import { organizationPageUpdatePushRoute } from './organizationPageUpdate';

export type NotificationRoutingFlags = { creatorPages: boolean; communities: boolean };

/** Resolve a notification pointer only; admission and actions remain at its destination. */
export function notificationDestination(data: Record<string, any>, flags: NotificationRoutingFlags): string {
  const type = data?.type as string | undefined;
  if (type === 'operator_grant') { return '/creator/apply'; }
  const joinRoute = communityJoinPushRoute(data, flags.creatorPages);
  if (joinRoute) { return joinRoute; }
  const attendeeRoute = attendeeMessagePushRoute(data, flags.communities);
  if (attendeeRoute) { return attendeeRoute; }
  const invitationRoute = pageInvitationPushRoute(data, flags.creatorPages);
  if (invitationRoute) { return invitationRoute; }
  const pageUpdateRoute = organizationPageUpdatePushRoute(data, flags.creatorPages);
  if (pageUpdateRoute) { return pageUpdateRoute; }
  const communityRoute = communityChatPushRoute(data, flags.communities);
  if (communityRoute) { return communityRoute; }
  const memberReactionRoute = memberReactionPushRoute(data);
  if (memberReactionRoute) { return memberReactionRoute; }

  // Album notifications: prompt/reminder/no-uploads-nudge open the upload
  // flow; ready/someone-uploaded/more-photos-added/hearts-batched open the
  // album detail view. eventId now lives in the same outer condition as
  // every other type-specific branch below (waitlist/plan/etc.), not a
  // nested check inside the branch body: previously a type match with no
  // eventId (malformed payload, future shape change) fell into the `if`
  // with nothing to push, which ended the whole if/else-if chain right
  // there -- the tap did literally nothing, instead of falling through
  // to the generic id-based fallback chain like every other type
  // already does. Consistency fix so no notification type can silently
  // no-op on tap.
  if (
    (type === 'album_upload_prompt' || type === 'album_upload_reminder' || type === 'album_creator_no_uploads_nudge') &&
    data?.eventId
  ) {
    return `/album/upload/${data.eventId}`;
  } else if (
    (type === 'album_ready' || type === 'album_someone_uploaded' || type === 'album_more_photos_added' || type === 'album_hearts_batched') &&
    data?.eventId
  ) {
    return `/album/${data.eventId}`;
  } else if (
    (type === 'waitlist_request' || type === 'exception_slot_refunded') &&
    data?.eventId
  ) {
    // Creator-side waitlist-exception pushes open the manager screen
    // (creator-only server-side; non-creators get the auth screen there).
    return `/waitlist/${data.eventId}`;
  } else if (
    (type === 'plan_invite' ||
      type === 'plan_cancelled' ||
      type === 'waitlist_spot' ||
      type === 'duplicate_plan' ||
      type === 'interest_signal' ||
      type === 'interest_invite' ||
      type === 'exception_invite') &&
    data?.eventId
  ) {
    // Tag the URL when the push is the creator-side "someone signaled
    // interest" notification, so the plan detail can surface the
    // "Would go next time" section explicitly. Receiver may currently
    // no-op on the param; it's a marker for future scroll/analytics.
    const focusParam = type === 'interest_signal' ? '?focus=interest' : '';
    return `/plan/${data.eventId}${focusParam}`;
  } else if (type === 'people_request') {
    // An incoming add-request: route to People and OPEN the requests LIST
    // (YoursScreen consumes ?openRequests=1). The notification is a pointer
    // ONLY; it never accepts/declines/destroys anything. If the push payload
    // carries the requester id, float that person to the top of the list;
    // otherwise the full pending list (each row individually actionable)
    // already makes wrong-target impossible.
    const requester =
      data?.actorUserId ?? data?.actor_user_id ?? data?.requesterId ?? null;
    return requester
      ? `/(tabs)/friends?openRequests=1&tab=people&requesterId=${requester}`
      : '/(tabs)/friends?openRequests=1&tab=people';
  } else if (
    type === 'people_request_accepted' ||
    type === 'referral_joined'
  ) {
    // Yours system: the request banner + swipe stack live on the
    // Yours page. Single inbox routes people notifications there.
    return '/(tabs)/friends?tab=people';
  } else if (type === 'people_ping' && data?.eventId) {
    // A ping IS the plan, open the plan detail, not the chat.
    return `/plan/${data.eventId}`;
  } else if (type === 'community_join_request') {
    // A join request is the leader's to answer: the wants-in list lives
    // on the creator members tab. No flag guard: only grant-holders get
    // this push, and the creator shell itself admits by grant, so a
    // non-creator tapping a stale push still gets redirected out of the
    // shell safely while the flag keeps the surface dark to the public.
    return '/(tabs)/friends/manage/(tools)/members';
  } else if (flags.communities && type === 'community_event') {
    // "just posted <event>" lands on Scene, where the event lives. The
    // payload carries no event id by design (event_id is the plans FK).
    return '/(tabs)/explore';
    // Source-less join decisions retain the generic chats-list fallback.
  } else if (data?.circleId) {
    // Circle chat push (20260605000200_circle_message_push.sql +
    // 20260827223000_claim_rpc_add_circle_topic_ids.sql):
    // circle chat lives at a different route than plan chat, not the
    // generic eventId fallback below.
    return `/(tabs)/chats/circle/${data.circleId}`;
  } else if (data?.topicId) {
    // Community room push (20260827220000_community_topic_message_push.sql
    // + 20260827223000_claim_rpc_add_circle_topic_ids.sql). The database
    // contract suite proves both migrations remain present and wired.
    return `/community-topic/${data.topicId}`;
  } else if (data?.chatId) {
    return `/(tabs)/chats/${data.chatId}`;
  } else if (data?.eventId) {
    return `/(tabs)/chats/${data.eventId}`;
  } else {
    // Final fallback for notification types that carry neither eventId
    // nor chatId (e.g. broadcast, future admin pings). Drop the user on
    // the chats list rather than no-op'ing the tap.
    return '/(tabs)/chats';
  }
}
