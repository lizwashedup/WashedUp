import React from 'react';
import { act, create } from 'react-test-renderer';
import { useTypingIndicator } from '../useTypingIndicator';

const mockChannels: any[] = [];
jest.mock('../../lib/supabase', () => ({ supabase: {
  channel: (name: string) => {
    const channel: any = { name, send: jest.fn().mockResolvedValue(undefined), on: (_type: string, _filter: any, callback: any) => { channel.receive = callback; return channel; }, subscribe: (callback: any) => { channel.status = callback; return channel; } };
    mockChannels.push(channel); return channel;
  },
  removeChannel: jest.fn(),
} }));
type Scene = { id?: string; user: string | null; name: string | null; kind: 'event' | 'circle' | 'community-topic'; scope?: { userId: string; isCurrent: () => boolean } | null };
let tree: ReturnType<typeof create>, typing: ReturnType<typeof useTypingIndicator>;
function Harness({ scene }: { scene: Scene }) { typing = useTypingIndicator(scene.id, scene.user, scene.name, scene.kind, scene.scope); return null; }
const initial: Scene = { id: 'plan-a', user: 'alice', name: 'Alice', kind: 'event' };
function mount(scene = initial) { act(() => { tree = create(<Harness scene={scene} />); }); }
function update(scene: Scene) { act(() => { tree.update(<Harness scene={scene} />); }); }
function subscribe(index = mockChannels.length - 1) { act(() => mockChannels[index].status('SUBSCRIBED')); }
function receive(index: number, userId = 'friend', name = 'Friend', isTyping = true) { act(() => mockChannels[index].receive({ payload: { userId, name, isTyping } })); }
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-13T12:00:00Z')); mockChannels.splice(0); });
afterEach(() => { act(() => tree?.unmount()); jest.clearAllTimers(); jest.useRealTimers(); });

it('clears an old room’s rendered peers even when the next room receives no broadcasts', () => {
  mount(); receive(0); expect(typing.typingUsers).toEqual([{ userId: 'friend', name: 'Friend' }]);
  update({ ...initial, id: 'circle-b', kind: 'circle' });
  expect(typing.typingUsers).toEqual([]);
  act(() => jest.advanceTimersByTime(10_000)); expect(typing.typingUsers).toEqual([]);
});

it('ignores old room callbacks and late subscription status across ABA', () => {
  mount(); const old = mockChannels[0];
  update({ ...initial, id: 'plan-b' }); update(initial);
  act(() => { old.status('SUBSCRIBED'); old.receive({ payload: { userId: 'private', name: 'Old room person', isTyping: true } }); typing.broadcastTyping(); });
  expect(typing.typingUsers).toEqual([]); expect(mockChannels.at(-1).send).not.toHaveBeenCalled();
});

it('a retained sender cannot broadcast an old account onto the current channel', () => {
  mount(); subscribe(); const old = typing.broadcastTyping;
  update({ ...initial, user: 'bob', name: 'Bob' }); subscribe();
  act(() => old()); expect(mockChannels.at(-1).send).not.toHaveBeenCalled();
});

it('a scope retirement stops outgoing timers and rejects incoming events before a rerender', () => {
  let current = true; mount({ ...initial, scope: { userId: 'alice', isCurrent: () => current } }); subscribe();
  act(() => typing.broadcastTyping()); expect(mockChannels[0].send).toHaveBeenCalledTimes(1);
  current = false; receive(0, 'private', 'Retired room'); act(() => jest.advanceTimersByTime(5000));
  expect(typing.typingUsers).toEqual([]); expect(mockChannels[0].send).toHaveBeenCalledTimes(1);
});

it('does not subscribe while an explicitly supplied account scope is unknown', () => {
  mount({ ...initial, scope: null }); expect(mockChannels).toHaveLength(0);
});

it('a new account epoch with the same IDs retires old incoming and outgoing callbacks', () => {
  let current = true; mount({ ...initial, scope: { userId: 'alice', isCurrent: () => current } }); subscribe(); const old = typing.broadcastTyping;
  current = false; update({ ...initial, scope: { userId: 'alice', isCurrent: () => true } }); subscribe();
  receive(0, 'private', 'Previous epoch'); act(() => old());
  expect(typing.typingUsers).toEqual([]); expect(mockChannels[1].send).not.toHaveBeenCalled();
});

it('unknown or mismatched scoped identity fails closed before subscribing', () => {
  mount({ ...initial, scope: { userId: 'bob', isCurrent: () => true } });
  expect(mockChannels).toHaveLength(0); act(() => typing.broadcastTyping());
  expect(typing.typingUsers).toEqual([]);
});

it('unmounted callbacks cannot send, recreate a timer or publish a peer', () => {
  mount(); subscribe(); const old = typing.broadcastTyping, channel = mockChannels[0];
  act(() => tree.unmount()); act(() => { old(); channel.status('SUBSCRIBED'); channel.receive({ payload: { userId: 'other', isTyping: true } }); });
  expect(channel.send).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});

it.each(['event', 'circle', 'community-topic'] as const)('preserves %s channel naming, payload and throttle/expiry', kind => {
  mount({ ...initial, kind }); subscribe();
  const channel = mockChannels[0]; expect(channel.name).toBe(kind === 'event' ? 'typing:plan-a' : `typing:${kind}:plan-a`);
  act(() => { typing.broadcastTyping(); typing.broadcastTyping(); });
  expect(channel.send).toHaveBeenCalledTimes(1);
  expect(channel.send).toHaveBeenLastCalledWith({ type: 'broadcast', event: 'typing', payload: { userId: 'alice', name: 'Alice', isTyping: true } });
  receive(0); act(() => jest.advanceTimersByTime(3001)); act(() => typing.broadcastTyping()); expect(channel.send).toHaveBeenCalledTimes(2);
  act(() => jest.advanceTimersByTime(5000)); expect(typing.typingUsers).toEqual([]);
  expect(channel.send).toHaveBeenLastCalledWith({ type: 'broadcast', event: 'typing', payload: { userId: 'alice', name: 'Alice', isTyping: false } });
});
