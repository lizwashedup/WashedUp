import { communityJoinPushRoute } from '../../lib/communityJoinNotification';
import { memberReactionPushRoute } from '../../lib/memberReactionPushRoute';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
import { attendeeMessagePushRoute } from '../../lib/attendeeMessageNotification';
import { organizationPageUpdatePushRoute } from '../../lib/organizationPageUpdate';
import { pageInvitationPushRoute } from '../../lib/pageInvitationNotification';
import { communityChatPushRoute } from '../../lib/communityChatPushRoute';
const source = fs.readFileSync(path.join(__dirname, '../_layout.tsx'), 'utf8');
const start = source.indexOf('  useEffect(() => {\n    // OneSignal click handler.');
const end = source.indexOf('\n  // Badge clearing moved', start);
if (start < 0 || end < 0) throw Error('Notification effect boundary changed');
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const community = '11111111-1111-4111-8111-111111111111', topic = '22222222-2222-4222-8222-222222222222', message = '33333333-3333-4333-8333-333333333333';
function mount() {
  const push = jest.fn(), stopExpo = jest.fn(), add = jest.fn(), remove = jest.fn();
  let expo: ((data: Record<string, unknown>) => void) | undefined, cleanup: () => void = () => {};
  const subscribeExpoNotificationResponses = jest.fn((callback: (data: Record<string, unknown>) => void) => { expo = callback; return stopExpo; });
  const context = { useEffect: (run: () => () => void) => { cleanup = run(); }, safePush: push,
    communityJoinPushRoute, attendeeMessagePushRoute, organizationPageUpdatePushRoute, pageInvitationPushRoute, communityChatPushRoute, memberReactionPushRoute,
    COMMUNITIES_ENABLED: true, CREATOR_PAGES_ENABLED: true, YOURS_PAGE_ENABLED: true, COMMUNITY_CHAT_GROUPING_ENABLED: false,
    initOneSignal: async () => true, OneSignal: { Notifications: { addEventListener: add, removeEventListener: remove } },
    subscribeExpoNotificationResponses, __DEV__: false };
  vm.runInNewContext(code, context);
  return { push, stopExpo, add, remove, cleanup: () => cleanup(), subscribeExpoNotificationResponses, tap: (data: Record<string, unknown>) => expo?.(data) };
}
it('registers Expo responses and routes a community reaction to its exact message', () => {
  const app = mount();
  expect(app.subscribeExpoNotificationResponses).toHaveBeenCalledTimes(1);
  app.tap({ type: 'community_broadcast', communityId: community, communityBroadcastId: message, reactionMessageId: message, reactionMessageSource: 'broadcast' });
  expect(app.push).toHaveBeenCalledWith(`/community-thread/${community}?reactionMessageId=${message}&reactionMessageSource=broadcast`);
});
it('uses the same existing route for topic reactions from Expo and OneSignal', async () => {
  const app = mount(); await Promise.resolve();
  const data = { type: 'new_message', topicId: topic, reactionMessageId: message, reactionMessageSource: 'topic' };
  app.tap(data); app.add.mock.calls[0][1]({ notification: { additionalData: data } });
  expect(app.push.mock.calls).toEqual([[`/community-topic/${topic}?reactionMessageId=${message}&reactionMessageSource=topic`], [`/community-topic/${topic}?reactionMessageId=${message}&reactionMessageSource=topic`]]);
});
it.each([
  [{ type: 'new_message', eventId: 'plan' }, '/(tabs)/chats/plan'],
  [{ type: 'new_message', circleId: 'circle' }, '/(tabs)/chats/circle/circle'],
  [{ type: 'album_ready', eventId: 'plan' }, '/album/plan'],
  [{ type: 'plan_invite', eventId: 'plan' }, '/plan/plan'],
  [{ type: 'attendee_message', exploreEventId: community }, `/event/${community}`],
])('preserves the existing destination through Expo for %p', (data, route) => {
  const app = mount(); app.tap(data); expect(app.push).toHaveBeenCalledWith(route);
});
it('removes both provider response subscriptions on effect cleanup', async () => {
  const app = mount(); await Promise.resolve(); app.cleanup();
  expect(app.stopExpo).toHaveBeenCalledTimes(1); expect(app.remove).toHaveBeenCalledWith('click', app.add.mock.calls[0][1]);
});

it.each(['eventId', 'circleId'])('preserves exact member reaction identity for both transports: %s', async parent => {
  const app = mount(); await Promise.resolve();
  const data = { type: 'new_message', [parent]: community, reactionMessageId: message, reactionMessageSource: 'chat' };
  app.tap(data); app.add.mock.calls[0][1]({ notification: { additionalData: data } });
  const route = `/(tabs)/chats/${parent === 'circleId' ? 'circle/' : ''}${community}?reactionMessageId=${message}&reactionMessageSource=chat`;
  expect(app.push.mock.calls).toEqual([[route], [route]]);
});

it('opens fresh application status for operator decisions through both providers without trusting body or route IDs',async()=>{
 const app=mount();await Promise.resolve();const data={type:'operator_grant',title:'Approved organization',body:'Ignored body',eventId:'wrong-event',communityId:community};
 app.tap(data);app.add.mock.calls[0][1]({notification:{additionalData:data}});expect(app.push.mock.calls).toEqual([['/creator/apply'],['/creator/apply']]);
});

// cleanup_waitlist_on_event_terminal emits this type with event_id only;
// both workers expose it as eventId, without granting the waitlisted person chat access.
it('opens exact cancelled plan details for the actual producer payload through both providers', async () => {
  const app = mount(); await Promise.resolve();
  const data = { type: 'plan_cancelled', eventId: community };
  app.tap(data); app.add.mock.calls[0][1]({ notification: { additionalData: data } });
  expect(app.push.mock.calls).toEqual([[`/plan/${community}`], [`/plan/${community}`]]);
});
it('keeps the existing safe fallback when a cancellation payload has no plan identity', () => {
  const app = mount(); app.tap({ type: 'plan_cancelled' });
  expect(app.push).toHaveBeenCalledWith('/(tabs)/chats');
});
