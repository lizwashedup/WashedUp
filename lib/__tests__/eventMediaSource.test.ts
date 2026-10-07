const mockSession = jest.fn(), mockUser = jest.fn(), mockPublic = jest.fn((path: string) => ({ data: { publicUrl: `legacy/${path}` } }));
jest.mock('../supabase', () => ({ SUPABASE_URL: 'http://127.0.0.1:55321', SUPABASE_ANON_KEY: 'anonymous-test-key', supabase: {
  auth: { getSession: () => mockSession(), getUser: () => mockUser() }, storage: { from: () => ({ getPublicUrl: mockPublic }) },
} }));
import { eventMediaReference, loadEventMediaSource } from '../eventMediaSource';
const event = '11111111-1111-4111-8111-111111111111', media = '22222222-2222-4222-8222-222222222222';
const path = `${event}/private-${media}.jpg`, cover = `creator-event-media:${path}`;
const scope = { userId: 'member', isCurrent: () => true };
beforeEach(() => {
  jest.clearAllMocks();
  mockUser.mockResolvedValue({ data: { user: { id: 'member' } }, error: null });
  mockSession.mockResolvedValue({ data: { session: { user: { id: 'member' }, access_token: 'member-token' } }, error: null });
});
it('preserves legacy cover URLs and the existing body bucket', () => {
  expect(eventMediaReference(event, 'https://legacy/photo.jpg', 'cover')).toEqual({ type: 'legacy', uri: 'https://legacy/photo.jpg' });
  expect(eventMediaReference(event, `${event}/old.mp4`, 'video')).toEqual({ type: 'legacy', uri: `legacy/${event}/old.mp4` });
  expect(mockPublic).toHaveBeenCalledTimes(1);
});
it.each(['cover', 'image', 'poster', 'video'] as const)('uses authenticated Storage and disables video caching for %s', async kind => {
  const ref = kind === 'cover' ? cover : kind === 'video' ? path.replace('.jpg', '.mp4') : path;
  const source = await loadEventMediaSource(event, ref, kind, scope);
  expect(source.uri).toBe(`http://127.0.0.1:55321/storage/v1/object/authenticated/creator-event-media/${kind === 'video' ? path.replace('.jpg', '.mp4') : path}`);
  expect(source.headers.Authorization).toBe('Bearer member-token');
  expect(source.headers['Cache-Control']).toContain('no-store');
  expect(source.useCaching).toBe(false); expect(mockPublic).not.toHaveBeenCalled();
});
it.each([
  [event, cover + '?token=other', 'cover'], [event, cover.replace(event, media), 'cover'],
  [event, cover.replace('.jpg', '.mp4'), 'cover'], [event, path, 'video'], [event, cover, 'image'],
  [event, path, 'cover'], [event, `creator-event-media:../${path}`, 'cover'],
  [event, `https://example.test/creator-event-media/${path}`, 'cover'],
  [event, path.replace(media, 'bad'), 'image'], [event, path.toUpperCase(), 'image'],
] as const)('rejects malformed, cross-event and wrong-media references: %s %s %s', async (id, ref, kind) => {
  expect(eventMediaReference(id, ref, kind)).toEqual({ type: 'invalid' });
  await expect(loadEventMediaSource(id, ref, kind, scope)).rejects.toThrow('unavailable');
  expect(mockPublic).not.toHaveBeenCalled(); expect(mockSession).not.toHaveBeenCalled();
});
it('supports confirmed signed-out viewers with the anonymous key, without bypassing RLS', async () => {
  mockSession.mockResolvedValue({ data: { session: null }, error: null });
  expect((await loadEventMediaSource(event, cover, 'cover', { ...scope, userId: null })).headers.Authorization).toBe('Bearer anonymous-test-key');
  expect(mockUser).not.toHaveBeenCalled();
});
it('reads a refreshed token after verifying the user', async () => {
  mockUser.mockImplementation(async () => { mockSession.mockResolvedValue({ data: { session: { user: { id: 'member' }, access_token: 'fresh' } } }); return { data: { user: { id: 'member' } } }; });
  expect((await loadEventMediaSource(event, cover, 'cover', scope)).headers.Authorization).toBe('Bearer fresh');
});
it('rejects account switches and authentication errors without returning credentials', async () => {
  mockSession.mockResolvedValue({ data: { session: { user: { id: 'other' }, access_token: 'other-token' } } });
  await expect(loadEventMediaSource(event, cover, 'cover', scope)).rejects.toThrow();
  mockUser.mockResolvedValue({ data: { user: null }, error: Error('offline') });
  await expect(loadEventMediaSource(event, cover, 'cover', scope)).rejects.toThrow();
});
it('rejects late authentication after the initiating visit retires', async () => {
  let current = true;
  mockUser.mockImplementation(async () => { current = false; return { data: { user: { id: 'member' } } }; });
  await expect(loadEventMediaSource(event, cover, 'cover', { ...scope, isCurrent: () => current })).rejects.toThrow();
  expect(mockSession).not.toHaveBeenCalled();
});
it('does not downgrade an authenticated viewer with a missing token to anonymous access', async () => {
  mockSession.mockResolvedValue({ data: { session: { user: { id: 'member' } } }, error: null });
  await expect(loadEventMediaSource(event, cover, 'cover', scope)).rejects.toThrow();
});
