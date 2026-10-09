import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useChatList } from '../useChatList';
import { chatListMemoryCache, removeBlockedPrivateChatPreviews } from '../../lib/chatListCache';

let mockEngine = false, mockOffline = false;
let mockIncoming: (payload: any) => Promise<void>;
const mockPrivacy = jest.fn(), mockProfile = jest.fn();
jest.mock('../../constants/FeatureFlags', () => ({ GROUPS_ENABLED: true, get CHAT_ENGINE_ENABLED() { return mockEngine; } }));
jest.mock('../../lib/chatEngine/senderCache', () => ({ seedSender: jest.fn() }));
const mockMembers = [
  { circle_id: 'dm', user_id: 'viewer', profiles_public: { first_name_display: 'You', profile_photo_url: null } },
  { circle_id: 'dm', user_id: 'peer', profiles_public: { first_name_display: 'Synthetic person', profile_photo_url: 'https://example.test/peer.jpg' } },
];
jest.mock('../../lib/supabase', () => ({ supabase: {
  rpc: (name: string, args: any) => name === 'yours_is_blocked_between' ? mockPrivacy(args) : Promise.resolve({ data: [{
    circle_id: 'dm', name: '', created_at: '2026-10-01T20:00:00Z', member_count: 2,
    members: mockMembers.map(member => ({ user_id: member.user_id, first_name: member.profiles_public.first_name_display, avatar_url: member.profiles_public.profile_photo_url })),
    last_message: { user_id: 'peer', content: 'Private preview', created_at: '2026-10-07T20:00:00Z' },
  }], error: null }),
  from: (table: string) => {
    let columns = '', viewer = '';
    const query: any = {
      select: (value: string) => { columns = value; return query; },
      eq: (key: string, value: string) => { if (key === 'user_id') viewer = value; return query; }, neq: () => query, in: () => query, order: () => query, limit: () => query,
      maybeSingle: () => mockProfile(),
      then: (resolve: any, reject: any) => {
        if (mockOffline) return Promise.resolve({ data: null, error: new Error('Offline') }).then(resolve, reject);
        let data: any[] = [];
        if (table === 'circle_members') data = columns.includes('circles (')
          ? viewer === 'viewer' ? [{ circles: { id: 'dm', name: '', created_at: '2026-10-01T20:00:00Z' } }] : []
          : mockMembers;
        if (table === 'circles') data = [{ id: 'dm', latest_message: [{ user_id: 'peer', content: 'Private preview', created_at: '2026-10-07T20:00:00Z' }] }];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    }; return query;
  },
  channel: () => { const channel = { on: (_event: any, _filter: any, callback: any) => { mockIncoming = callback; return channel; }, subscribe: () => channel }; return channel; },
  removeChannel: jest.fn(),
} }));
let tree: ReactTestRenderer, value: ReturnType<typeof useChatList>;
function Probe({ viewer = 'viewer' }) { value = useChatList(viewer); return null; }
async function mount() { await act(async () => { tree = create(<Probe/>); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  mockEngine = false; mockOffline = false; chatListMemoryCache.clear();
  mockPrivacy.mockReset().mockResolvedValue({ data: false, error: null });
  mockProfile.mockReset().mockResolvedValue({ data: { first_name_display: 'Late sender' }, error: null });
});
afterEach(() => act(() => tree?.unmount()));

it.each([false, true])('omits a mutually blocked private chat, its picture and preview (cards: %s)', async engine => {
  mockEngine = engine; mockPrivacy.mockResolvedValue({ data: true, error: null });
  await mount();
  expect(value.chats).toEqual([]);
  expect(mockPrivacy).toHaveBeenCalledWith({ p_a: 'viewer', p_b: 'peer' });
});

it.each([false, true])('keeps an allowed private chat unchanged (cards: %s)', async engine => {
  mockEngine = engine; await mount();
  expect(value.chats).toEqual([expect.objectContaining({ is_dm: true, dm_user_id: 'peer', title: 'Synthetic person', image_url: 'https://example.test/peer.jpg', last_message: expect.stringContaining('Private preview') })]);
});

it('does not paint the private row while its block check is unresolved', async () => {
  const privacy = deferred<any>(); mockPrivacy.mockReturnValueOnce(privacy.promise);
  await mount(); expect(value.chats).toEqual([]);
  await act(async () => privacy.resolve({ data: true, error: null }));
  expect(value.chats).toEqual([]);
});

it('fails closed when the mutual-block check returns an error', async () => {
  mockPrivacy.mockResolvedValue({ data: null, error: new Error('Privacy unavailable') });
  await mount(); expect(value.chats).toEqual([]);
});

it('removes a confirmed block immediately and keeps it absent through failed refresh and remount', async () => {
  await mount(); expect(value.chats).toHaveLength(1);
  mockOffline = true;
  await act(async () => removeBlockedPrivateChatPreviews('viewer', 'peer'));
  expect(value.chats).toEqual([]); expect(value.loadError).toBe(true);
  act(() => tree.unmount()); await mount(); expect(value.chats).toEqual([]);
});

it('rejects a pre-block response that completes after confirmation', async () => {
  await mount();
  const old = deferred<any>(); mockPrivacy.mockReturnValueOnce(old.promise);
  let refresh!: Promise<void>; act(() => { refresh = value.refetch(true); });
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
  mockPrivacy.mockResolvedValue({ data: true, error: null });
  await act(async () => removeBlockedPrivateChatPreviews('viewer', 'peer'));
  await act(async () => { old.resolve({ data: false, error: null }); await refresh; });
  expect(value.chats).toEqual([]);
});

it('does not let delayed realtime sender hydration restore a removed private preview', async () => {
  await mount(); const old = deferred<any>(); mockProfile.mockReturnValueOnce(old.promise);
  let receive!: Promise<void>;
  act(() => { receive = mockIncoming({ new: { circle_id: 'dm', user_id: 'uncached-sender', content: 'Late text', created_at: '2026-10-07T21:00:00Z' } }); });
  mockOffline = true;
  await act(async () => removeBlockedPrivateChatPreviews('viewer', 'peer'));
  await act(async () => { old.resolve({ data: { first_name_display: 'Late sender' }, error: null }); await receive; });
  expect(value.chats).toEqual([]);
});

it('does not remove another account’s inbox when the same person is blocked elsewhere', async () => {
  await mount(); await act(async () => removeBlockedPrivateChatPreviews('another-viewer', 'peer'));
  expect(value.chats).toHaveLength(1);
});

it('revalidates privacy after an account changes during a pending private-chat read', async () => {
  const old = deferred<any>(); mockPrivacy.mockReturnValueOnce(old.promise);
  await mount(); mockPrivacy.mockResolvedValue({ data: true, error: null });
  await act(async () => tree.update(<Probe viewer="next-viewer"/>));
  await act(async () => old.resolve({ data: false, error: null }));
  expect(value.chats).toEqual([]);
});

it('does not paint a cached private row on a later visit before privacy is revalidated', async () => {
  await mount(); expect(value.chats).toHaveLength(1);
  act(() => tree.unmount());
  const privacy = deferred<any>(); mockPrivacy.mockReturnValueOnce(privacy.promise);
  await mount();
  expect(value.chats).toEqual([]);
  await act(async () => privacy.resolve({ data: true, error: null }));
  expect(value.chats).toEqual([]);
});

it('does not restore a cached private row when the next visit cannot reach the server', async () => {
  await mount(); expect(value.chats).toHaveLength(1);
  act(() => tree.unmount()); mockOffline = true;
  await mount();
  expect(value.chats).toEqual([]);
  expect(value.loadError).toBe(true);
});
