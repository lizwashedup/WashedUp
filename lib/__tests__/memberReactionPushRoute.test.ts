import { memberReactionPushRoute } from '../memberReactionPushRoute';
const room = '11111111-1111-4111-8111-111111111111', message = '22222222-2222-4222-8222-222222222222';
const base = { type: 'new_message', eventId: room, circleId: null, reactionMessageId: message, reactionMessageSource: 'chat' };
it('routes a Plan reaction to the exact message', () => {
  expect(memberReactionPushRoute(base)).toBe(`/(tabs)/chats/${room}?reactionMessageId=${message}&reactionMessageSource=chat`);
});
it('routes Circle and direct reactions through their existing Circle screen', () => {
  expect(memberReactionPushRoute({ ...base, eventId: null, circleId: room })).toBe(`/(tabs)/chats/circle/${room}?reactionMessageId=${message}&reactionMessageSource=chat`);
});
it.each([
  { type: 'new_message', eventId: room }, { type: 'new_message', circleId: room },
  { ...base, type: 'plan_invite' }, { ...base, type: 'community_broadcast' }, { ...base, topicId: room }, {},
])('leaves unrelated and ordinary routes unchanged: %p', data => expect(memberReactionPushRoute(data)).toBeNull());
it.each([
  { reactionMessageId: '../other' }, { reactionMessageId: [message] }, { reactionMessageId: null },
  { reactionMessageSource: 'topic' }, { reactionMessageSource: null }, { eventId: '../other' },
  { eventId: [room] }, { eventId: null }, { circleId: room },
])('refuses malformed or ambiguous reaction identities: %p', delta => {
  expect(memberReactionPushRoute({ ...base, ...delta })).toBe('/(tabs)/chats');
});
