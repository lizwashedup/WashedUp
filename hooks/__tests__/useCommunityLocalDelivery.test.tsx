import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useCommunityLocalDelivery } from '../useCommunityLocalDelivery';
import type { CommunityBroadcast } from '../../lib/communityChat';
import type { TopicDraftAttempt } from '../../lib/topicComposerDraft';
let live = true;
const owner = { userId: 'alice', isCurrent: () => live };
const original: TopicDraftAttempt = { id: 'original', kind: 'send', text: 'Hello', replyId: null, edit: null };
let hook: ReturnType<typeof useCommunityLocalDelivery>, tree: ReactTestRenderer;
function Harness({ scope = owner, messages = [] as CommunityBroadcast[], attempt = original as TopicDraftAttempt | null, sending = true }) {
  hook = useCommunityLocalDelivery(scope, messages, attempt, sending); return null;
}
beforeEach(() => { live = true; });
afterEach(() => act(() => tree?.unmount()));
it('shows sending, then a same-ID confirmed row until history catches up exactly once', () => {
  act(() => { tree = create(<Harness />); });
  expect(hook.messages).toMatchObject([{ id: 'original', body: 'Hello', localDelivery: 'sending' }]);
  act(() => hook.confirm(original));
  act(() => tree.update(<Harness attempt={null} sending={false}/>));
  expect(hook.messages).toMatchObject([{ id: 'original', localDelivery: 'sent' }]);
  const saved = { ...hook.messages[0], localDelivery: undefined, sender_name: 'Alice' };
  act(() => tree.update(<Harness messages={[saved]} attempt={null} sending={false}/>));
  expect(hook.messages).toEqual([saved]);
  act(() => tree.update(<Harness messages={[]} attempt={null} sending={false}/>));
  expect(hook.messages).toEqual([]); // A later authoritative delete must not resurrect the local copy.
});
it('keeps unconfirmed originals visible and does not deduplicate distinct equal-text messages', () => {
  act(() => { tree = create(<Harness sending={false}/>); });
  expect(hook.messages[0].localDelivery).toBe('unconfirmed');
  const other = { ...hook.messages[0], id: 'another', localDelivery: undefined };
  act(() => tree.update(<Harness sending={false} messages={[other]}/>));
  expect(hook.messages.map(row => row.id)).toEqual(['original', 'another']);
});
it('an early realtime echo wins over the pending copy without displaying two messages', () => {
  act(() => { tree = create(<Harness />); });
  const echo = { ...hook.messages[0], localDelivery: undefined };
  act(() => tree.update(<Harness messages={[echo]}/>));
  expect(hook.messages).toEqual([echo]);
});
it('does not carry local text or late confirmation into a new account/room visit', () => {
  act(() => { tree = create(<Harness />); }); const oldConfirm = hook.confirm;
  const next = { userId: 'bob', isCurrent: () => true };
  act(() => tree.update(<Harness scope={next} attempt={null}/>));
  act(() => oldConfirm(original));
  expect(hook.messages).toEqual([]);
});
it('a retired original cannot be locally confirmed', () => {
  act(() => { tree = create(<Harness />); }); live = false;
  act(() => hook.confirm(original));
  expect(hook.messages[0].localDelivery).toBe('sending');
});
it('does not append a second bubble for an edit', () => {
  act(() => { tree = create(<Harness attempt={{...original, kind:'edit',edit:{id:'original',body:'Before',edited_at:null}}}/>); });
  expect(hook.messages).toEqual([]);
});

it('keeps a long unchanged history stable through unrelated composer renders', () => {
  act(() => { tree = create(<Harness />); });
  const messages = Array.from({ length: 500 }, (_, i) => ({ ...hook.messages[0], id: `saved-${i}`, localDelivery: undefined }));
  act(() => tree.update(<Harness messages={messages} attempt={null} sending={false}/>));
  const first = hook.messages;
  for (let i = 0; i < 25; i++) {
    act(() => tree.update(<Harness messages={messages} attempt={null} sending={false}/>));
    expect(hook.messages).toBe(first);
  }
  expect(hook.messages).toBe(messages);
});

it('reuses an unchanged pending list but updates delivery status and same-ID server edits', () => {
  const messages: CommunityBroadcast[] = [];
  act(() => { tree = create(<Harness messages={messages}/>); });
  const pending = hook.messages;
  act(() => tree.update(<Harness messages={messages}/>));
  expect(hook.messages).toBe(pending);
  act(() => tree.update(<Harness messages={messages} sending={false}/>));
  expect(hook.messages).not.toBe(pending);
  expect(hook.messages[0].localDelivery).toBe('unconfirmed');
  const echo = { ...hook.messages[0], localDelivery: undefined };
  act(() => tree.update(<Harness messages={[echo]} attempt={null} sending={false}/>));
  const edited = { ...echo, body: 'Edited on the other device', edited_at: '2026-10-07T20:00:00Z' };
  act(() => tree.update(<Harness messages={[edited]} attempt={null} sending={false}/>));
  expect(hook.messages).toEqual([edited]);
});
