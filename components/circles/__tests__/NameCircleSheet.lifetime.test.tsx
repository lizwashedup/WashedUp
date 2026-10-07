import React from 'react';
import { Modal, ScrollView, Text, TextInput } from 'react-native';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NameCircleSheet, { type NameCircleSheetProps } from '../NameCircleSheet';

const mockRpc = jest.fn(), mockGetUser = jest.fn(), mockPick = jest.fn(), mockUpload = jest.fn(), mockUuid = jest.fn();
let mockViewer: string | null = 'alice';
const mockListeners = new Set<(event: string, session: { user: { id: string } } | null) => void>();
jest.mock('../../../lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => mockRpc(...args),
  auth: { getUser: () => mockGetUser(), onAuthStateChange: (callback: (event: string, session: any) => void) => {
    mockListeners.add(callback); return { data: { subscription: { unsubscribe: () => mockListeners.delete(callback) } } };
  } },
  storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.invalid/${path}` } }) }) },
} }));
jest.mock('../../../lib/circles/pickCover', () => ({ pickCoverPhoto: () => mockPick() }));
jest.mock('../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: (...args: unknown[]) => mockUpload(...args) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => mockUuid() }));
jest.mock('../../yours/circles/CircleCover', () => ({ __esModule: true, default: (props: any) => require('react').createElement('CoverPreview', props) }));
jest.mock('lucide-react-native', () => ({ X: () => null, ImagePlus: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
const picked = { base64: 'photo-bytes', uri: 'file:///chosen.jpg' };
const account = () => ({ data: { user: mockViewer ? { id: mockViewer } : null }, error: null });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
const cleanup: Array<() => void> = [];
function mount(extra: Partial<NameCircleSheetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries'); const close = jest.fn(), done = jest.fn();
  let props: NameCircleSheetProps = { visible: true, circleId: 'circle-a', userId: 'alice', onClose: close, onNamed: done, ...extra };
  let tree!: ReturnType<typeof create>; let closed = false;
  const render = () => <QueryClientProvider client={client}><NameCircleSheet {...props} /></QueryClientProvider>;
  act(() => { tree = create(render()); });
  const unmount = () => { if (!closed) act(() => tree.unmount()); closed = true; };
  cleanup.push(() => { unmount(); client.clear(); });
  const update = (next: Partial<NameCircleSheetProps>) => { props = { ...props, ...next }; act(() => tree.update(render())); };
  const button = (label: string) => tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  const inputs = () => tree.root.findAllByType(TextInput);
  return { tree, client, invalidate, done, close, update, unmount, button, inputs,
    name: (value = 'Weekend crew') => act(() => inputs()[0].props.onChangeText(value)),
    description: (value: string) => act(() => inputs()[1].props.onChangeText(value)),
    preview: () => tree.root.findByType('CoverPreview' as any).props,
    save: () => button('Save') ?? button('Try again'),
    pick: async () => { await act(async () => { await (button('Add a cover photo') ?? button('Change cover photo')).props.onPress(); }); },
    dismiss: () => act(() => tree.root.findByType(Modal).props.onRequestClose()),
    text: () => tree.root.findAllByType(Text).map(node => node.props.children).flat().join(' '),
    auth: (id: string | null, updateProp = true) => {
      mockViewer = id;
      act(() => { for (const listener of [...mockListeners]) listener(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); });
      if (updateProp) update({ userId: id });
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks(); mockViewer = 'alice'; mockListeners.clear();
  mockGetUser.mockReset().mockImplementation(async () => account());
  mockRpc.mockReset().mockResolvedValue({ error: null }); mockPick.mockReset().mockResolvedValue(picked);
  mockUpload.mockReset().mockResolvedValue('https://example.invalid/photo'); mockUuid.mockReset().mockReturnValue('cover-uuid');
});
afterEach(() => cleanup.splice(0).forEach(fn => fn()));

it('owns no identity reads or listeners while hidden', async () => {
  mount({ visible: false }); await flush(); expect(mockGetUser).not.toHaveBeenCalled(); expect(mockListeners.size).toBe(0);
});
it('preserves required name, optional description, trimming and success callback order', async () => {
  const order: string[] = []; const f = mount({ onNamed: () => order.push('named'), onClose: () => order.push('close') }); await flush();
  expect(f.save().props.disabled).toBe(true); f.name('  '); expect(f.save().props.disabled).toBe(true);
  f.name('  Weekend crew  '); f.description('  Around town  ');
  await act(async () => { await f.save().props.onPress(); });
  expect(mockRpc).toHaveBeenCalledWith('update_circle', { p_circle_id: 'circle-a', p_name: 'Weekend crew', p_description: 'Around town', p_cover_upload_id: null, p_clear_cover: false });
  expect(order).toEqual(['named', 'close']);
});
it('retains 60/140 limits and accessible field labels with keyboard scrolling', async () => {
  const f = mount(); await flush(); f.name('n'.repeat(70)); f.description('d'.repeat(150));
  expect(f.inputs()[0].props).toMatchObject({ maxLength: 60, accessibilityLabel: 'Circle name, required', value: 'n'.repeat(60) });
  expect(f.inputs()[1].props).toMatchObject({ maxLength: 140, accessibilityLabel: 'Circle description, optional', value: 'd'.repeat(140) });
  expect(f.text()).toContain('Name (required)'); expect(f.text()).toContain('Description (optional)');
  expect(f.tree.root.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
  expect(typeof f.tree.root.findByType(Modal).props.onAccessibilityEscape).toBe('function');
});
it('saves an empty optional description as null', async () => {
  const f = mount(); await flush(); f.name(); f.description('  ');
  await act(async () => { await f.save().props.onPress(); });
  expect(mockRpc).toHaveBeenCalledWith('update_circle', expect.objectContaining({ p_description: null }));
});
it('uploads an added cover before pointing the existing RPC at it', async () => {
  const f = mount(); await flush(); f.name(); await f.pick();
  expect(f.preview().coverUrl).toBe(picked.uri);
  await act(async () => { await f.save().props.onPress(); });
  expect(mockUpload).toHaveBeenCalledWith('circle-covers', 'circle-a/cover-uuid', picked.base64, { upsert: true });
  expect(mockRpc).toHaveBeenCalledWith('update_circle', expect.objectContaining({ p_cover_upload_id: 'cover-uuid', p_clear_cover: false }));
  expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(mockRpc.mock.invocationCallOrder[0]);
  expect(f.done).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1);
});
it('preserves saved-cover removal and lets a replacement pick win', async () => {
  const f = mount({ currentCoverUploadId: 'old-cover' }); await flush(); f.name();
  expect(f.preview().coverUrl).toContain('circle-a/old-cover');
  act(() => f.button('Remove cover').props.onPress()); expect(f.preview().coverUrl).toBeNull();
  await f.pick(); await act(async () => { await f.save().props.onPress(); });
  expect(mockRpc).toHaveBeenCalledWith('update_circle', expect.objectContaining({ p_clear_cover: false, p_cover_upload_id: 'cover-uuid' }));
});
it('clears a saved cover without uploading another', async () => {
  const f = mount({ currentCoverUploadId: 'old-cover' }); await flush(); f.name();
  act(() => f.button('Remove cover').props.onPress()); await act(async () => { await f.save().props.onPress(); });
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockRpc).toHaveBeenCalledWith('update_circle', expect.objectContaining({ p_clear_cover: true, p_cover_upload_id: null }));
});
it('keeps a chosen cover on picker cancellation and reports picker failures for retry', async () => {
  const f = mount(); await flush(); f.name(); await f.pick(); mockPick.mockResolvedValueOnce(null); await f.pick();
  expect(f.preview().coverUrl).toBe(picked.uri);
  mockPick.mockRejectedValueOnce(new Error('picker')); await f.pick(); expect(f.text()).toContain('Couldn’t open your photos');
  expect(f.preview().coverUrl).toBe(picked.uri); await f.pick(); expect(f.text()).not.toContain('Couldn’t open your photos');
});
it('serializes rapid picker calls and refuses save until the pick completes', async () => {
  const pick = deferred<typeof picked>(); mockPick.mockReturnValue(pick.promise); const f = mount(); await flush(); f.name();
  const choose = f.button('Add a cover photo').props.onPress, save = f.save().props.onPress;
  act(() => { choose(); choose(); save(); }); await flush(); expect(mockPick).toHaveBeenCalledTimes(1); expect(mockRpc).not.toHaveBeenCalled();
  await act(async () => pick.resolve(picked)); await flush(); expect(f.save().props.disabled).toBe(false);
});
it('locks rapid saves during upload, freezes captured fields and lets Cancel retire the write', async () => {
  const upload = deferred<string>(); mockUpload.mockReturnValue(upload.promise); const f = mount(); await flush(); f.name(); await f.pick();
  const save = f.save().props.onPress, rename = f.inputs()[0].props.onChangeText;
  act(() => { save(); save(); rename('Wrong new name'); }); await flush();
  expect(mockUpload).toHaveBeenCalledTimes(1); expect(f.inputs()[0].props.value).toBe('Weekend crew'); expect(f.inputs()[0].props.editable).toBe(false);
  f.dismiss(); f.dismiss(); expect(f.close).toHaveBeenCalledTimes(1);
  await act(async () => upload.resolve('uploaded')); await flush(); expect(mockRpc).not.toHaveBeenCalled(); expect(f.done).not.toHaveBeenCalled();
});
it('does not silently save name and description when the selected cover fails to upload', async () => {
  mockUpload.mockRejectedValueOnce(new Error('offline')); const f = mount(); await flush(); f.name(); f.description('Keep this'); await f.pick();
  await act(async () => { await f.save().props.onPress(); });
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.done).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
  expect(f.text()).toContain('Your cover didn’t upload'); expect(f.inputs()[0].props.value).toBe('Weekend crew'); expect(f.inputs()[1].props.value).toBe('Keep this');
  expect(f.preview().coverUrl).toBe(picked.uri); expect(f.save().props.accessibilityLabel).toBe('Try again');
  await act(async () => { await f.save().props.onPress(); });
  expect(mockUpload.mock.calls[0]).toEqual(mockUpload.mock.calls[1]); expect(mockUuid).toHaveBeenCalledTimes(1); expect(mockRpc).toHaveBeenCalledTimes(1); expect(f.done).toHaveBeenCalledTimes(1);
});
it('reuses a completed upload while retrying an unconfirmed identity save', async () => {
  mockRpc.mockResolvedValueOnce({ error: new Error('save unavailable') }); const f = mount(); await flush(); f.name(); await f.pick();
  await act(async () => { await f.save().props.onPress(); });
  expect(f.text()).toContain('Couldn’t confirm the save'); expect(f.close).not.toHaveBeenCalled(); expect(f.preview().coverUrl).toBe(picked.uri);
  await act(async () => { await f.save().props.onPress(); });
  expect(mockUpload).toHaveBeenCalledTimes(1); expect(mockRpc.mock.calls[0]).toEqual(mockRpc.mock.calls[1]); expect(f.done).toHaveBeenCalledTimes(1);
});
it.each(['picker', 'upload', 'rpc'])('retires late %s completion across closing and reopening', async stage => {
  const waiting = deferred<any>(); const f = mount(); await flush(); f.name();
  if (stage === 'picker') { mockPick.mockReturnValueOnce(waiting.promise); act(() => { void f.button('Add a cover photo').props.onPress(); }); }
  else {
    if (stage === 'upload') { await f.pick(); mockUpload.mockReturnValueOnce(waiting.promise); } else mockRpc.mockReturnValueOnce(waiting.promise);
    act(() => { void f.save().props.onPress(); });
  }
  await flush(); f.update({ visible: false }); f.update({ visible: true }); await flush(); f.name('New draft');
  await act(async () => waiting.resolve(stage === 'picker' ? picked : stage === 'upload' ? 'uploaded' : { error: null })); await flush();
  expect(f.inputs()[0].props.value).toBe('New draft'); expect(f.preview().coverUrl).toBeNull(); expect(f.save().props.disabled).toBe(false);
  expect(f.done).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
  if (stage !== 'rpc') expect(mockRpc).not.toHaveBeenCalled();
});
it.each(['picker', 'upload', 'rpc'])('does not show a retired %s failure in a reopened sheet', async stage => {
  const waiting = deferred<any>(); const f = mount(); await flush(); f.name();
  if (stage === 'picker') { mockPick.mockReturnValueOnce(waiting.promise); act(() => { void f.button('Add a cover photo').props.onPress(); }); }
  else { if (stage === 'upload') { await f.pick(); mockUpload.mockReturnValueOnce(waiting.promise); } else mockRpc.mockReturnValueOnce(waiting.promise); act(() => { void f.save().props.onPress(); }); }
  await flush(); f.update({ visible: false }); f.update({ visible: true }); await flush(); f.name('Fresh name');
  await act(async () => waiting.reject(new Error('retired failure'))); await flush();
  expect(f.text()).not.toContain('Couldn’t'); expect(f.text()).not.toContain('didn’t upload'); expect(f.done).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
});
it('does not upload if closed during the fresh account check', async () => {
  const auth = deferred<ReturnType<typeof account>>(); const f = mount(); await flush(); f.name(); await f.pick();
  mockGetUser.mockReturnValueOnce(auth.promise); act(() => { void f.save().props.onPress(); }); await flush(); f.dismiss();
  await act(async () => auth.resolve(account())); await flush(); expect(mockUpload).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
});
it('does not dispatch a no-cover update when Cancel follows Save in the same turn', async () => {
  const f = mount(); await flush(); f.name();
  act(() => { void f.save().props.onPress(); f.tree.root.findByType(Modal).props.onRequestClose(); }); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.done).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
});
it('keeps identity lookup errors retryable and Cancel reachable with a missing account', async () => {
  mockGetUser.mockRejectedValueOnce(new Error('identity unavailable')); const f = mount(); await flush();
  expect(f.save().props.disabled).toBe(true); expect(f.button('Retry account check')).toBeDefined(); expect(f.inputs()[0].props.editable).toBe(false);
  await act(async () => { await f.button('Retry account check').props.onPress(); }); await flush(); f.name(); expect(f.save().props.disabled).toBe(false);
  f.auth(null); await flush(); f.dismiss(); expect(f.close).toHaveBeenCalledTimes(1); expect(mockRpc).not.toHaveBeenCalled();
});
it('holds explicit null scope and mismatched supplied identity without writes', async () => {
  const f = mount({ scope: null }); await flush(); f.name(); expect(f.save().props.disabled).toBe(true); expect(f.inputs()[0].props.value).toBe('');
  f.update({ scope: undefined, userId: 'other' }); await flush(); f.name(); expect(f.save().props.disabled).toBe(true);
  f.dismiss(); expect(f.close).toHaveBeenCalledTimes(1); expect(mockUpload).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
});
it('resets drafts on room replacement but preserves them across ordinary metadata refresh', async () => {
  const scope = { userId: 'alice', isCurrent: () => true }; const f = mount({ scope }); await flush(); f.name(); f.description('Current draft'); await f.pick();
  f.update({ currentCoverUploadId: 'server-refresh' }); await flush(); expect(f.inputs()[0].props.value).toBe('Weekend crew'); expect(f.preview().coverUrl).toBe(picked.uri);
  f.update({ circleId: 'circle-b' }); await flush(); expect(f.inputs()[0].props.value).toBe(''); expect(f.inputs()[1].props.value).toBe(''); expect(f.preview().coverUrl).toContain('circle-b/server-refresh');
});
it('retires retained edits and delayed uploads when parent permission is lost', async () => {
  let current = true; const upload = deferred<string>(); mockUpload.mockReturnValue(upload.promise);
  const f = mount({ scope: { userId: 'alice', isCurrent: () => current } }); await flush(); f.name(); await f.pick();
  const edit = f.inputs()[0].props.onChangeText; act(() => { void f.save().props.onPress(); }); await flush(); current = false;
  act(() => edit('Retired edit')); await act(async () => upload.resolve('uploaded')); await flush();
  expect(mockRpc).not.toHaveBeenCalled(); expect(f.done).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
});
it('retires account A to B to A even before the parent updates its user prop', async () => {
  const upload = deferred<string>(); mockUpload.mockReturnValue(upload.promise); const f = mount(); await flush(); f.name(); await f.pick();
  act(() => { void f.save().props.onPress(); }); await flush(); f.auth('other', false); f.auth('alice', false); await flush(); f.name('Returned account draft');
  await act(async () => upload.resolve('uploaded')); await flush(); expect(mockRpc).not.toHaveBeenCalled(); expect(f.inputs()[0].props.value).toBe('Returned account draft');
});
it('keeps a draft and pending save across same-account token refresh', async () => {
  const write = deferred<{ error: null }>(); mockRpc.mockReturnValue(write.promise); const f = mount(); await flush(); f.name();
  act(() => { void f.save().props.onPress(); }); await flush();
  act(() => { for (const listener of [...mockListeners]) listener('TOKEN_REFRESHED', { user: { id: 'alice' } }); });
  expect(f.inputs()[0].props.value).toBe('Weekend crew'); await act(async () => write.resolve({ error: null })); await flush();
  expect(f.done).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1);
});
it('suppresses final close when onNamed has already retired the entry', async () => {
  let current = true; const f = mount({ scope: { userId: 'alice', isCurrent: () => current }, onNamed: () => { current = false; } }); await flush(); f.name();
  await act(async () => { await f.save().props.onPress(); }); expect(f.close).not.toHaveBeenCalled();
});
it.each(['picker', 'upload', 'rpc'])('retires %s on unmount and releases identity listeners', async stage => {
  const waiting = deferred<any>(); const f = mount(); await flush(); f.name();
  if (stage === 'picker') { mockPick.mockReturnValueOnce(waiting.promise); act(() => { void f.button('Add a cover photo').props.onPress(); }); }
  else { if (stage === 'upload') { await f.pick(); mockUpload.mockReturnValueOnce(waiting.promise); } else mockRpc.mockReturnValueOnce(waiting.promise); act(() => { void f.save().props.onPress(); }); }
  await flush(); f.unmount(); await act(async () => waiting.resolve(stage === 'picker' ? picked : stage === 'upload' ? 'uploaded' : { error: null })); await flush();
  expect(mockListeners.size).toBe(0); expect(f.done).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
  if (stage !== 'rpc') expect(mockRpc).not.toHaveBeenCalled();
});

it('checks the upload account immediately before storage and keeps a failed check retryable', async () => {
  const f = mount(); await flush(); f.name(); await f.pick();
  mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'other' } }, error: null });
  await act(async () => { await f.save().props.onPress(); });
  expect(mockUpload).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
  expect(f.text()).toContain('Couldn’t confirm your account'); expect(f.preview().coverUrl).toBe(picked.uri);
  await act(async () => { await f.save().props.onPress(); });
  expect(mockUpload).toHaveBeenCalledTimes(1); expect(f.done).toHaveBeenCalledTimes(1);
});
it('ignores a late initial account lookup after a newer auth event', async () => {
  const initial = deferred<ReturnType<typeof account>>(); mockGetUser.mockReturnValueOnce(initial.promise); const f = mount(); await flush();
  f.auth('other'); await flush(); f.name('Other account draft');
  await act(async () => initial.resolve({ data: { user: { id: 'alice' } }, error: null })); await flush();
  expect(f.inputs()[0].props.value).toBe('Other account draft'); expect(f.save().props.disabled).toBe(false);
  await act(async () => { await f.save().props.onPress(); }); expect(f.done).toHaveBeenCalledTimes(1);
});
