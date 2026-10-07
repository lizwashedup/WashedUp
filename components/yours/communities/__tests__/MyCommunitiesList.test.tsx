import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, RefreshControl } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyCommunitiesList } from '../MyCommunitiesList';
import { PageAction } from '../../../creator/pages/PageFrame';
import { PublishedPageCover } from '../../../creator/pages/PublishedPageCover';
import { Image } from 'expo-image';
let mockViewer: string | null = 'alice', mockEpoch = 1, mockAccountError: Error | null = null;
const mockRead = jest.fn(), mockRetry = jest.fn(), mockOpen = jest.fn(), mockBrowse = jest.fn();
jest.mock('../../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const epoch = mockEpoch;
  return { viewerId: mockViewer, epoch, isLoading: false, error: mockAccountError, isCurrent: () => epoch === mockEpoch, retry: mockRetry };
} }));
jest.mock('../../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../../../lib/communityPage', () => ({ getMyCommunities: () => mockRead() }));
jest.mock('../../../creator/pages/PageFrame', () => ({ PageAction: () => null }));
jest.mock('../../../creator/pages/PublishedPageCover', () => ({ PublishedPageCover: () => null }));
jest.mock('lucide-react-native', () => ({ ChevronRight: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));
jest.mock('expo-image', () => ({ Image: () => null }));
let tree: ReactTestRenderer, client: QueryClient, alive: boolean;
const row = { id: 'sunday', handle: 'sunday', name: 'Our Sunday Table', role: 'leader', member_count: 1, cover_image: null };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function content() { return <QueryClientProvider client={client}><MyCommunitiesList onOpen={mockOpen} onBrowse={mockBrowse} /></QueryClientProvider>; }
function mount() { act(() => { tree = create(content()); alive = true; }); }
function update() { act(() => tree.update(content())); }
function unmount() { if (alive) act(() => { tree.unmount(); alive = false; }); }
function words() { return tree.root.findAllByType(Text).map(n => n.props.children).join(' '); }
function action(title = 'Try again') { return tree.root.findAllByType(PageAction).find(n => n.props.title === title)!; }
function open(name = row.name) { return tree.root.findAll(n => n.props.accessibilityLabel === `Open ${name}` && typeof n.props.onPress === 'function')[0].props.onPress; }
async function flush() { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); await act(async () => { jest.advanceTimersByTime(1); for (let i = 0; i < 8; i++) await Promise.resolve(); }); }
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockViewer = 'alice'; mockEpoch = 1; mockAccountError = null; alive = false;
  mockRead.mockReset().mockResolvedValue([]); mockRetry.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { unmount(); client.clear(); jest.useRealTimers(); });
it('ends a stalled initial read at its deadline, then explicitly retries without accepting the late response', async () => {
  const late = deferred<any[]>(); mockRead.mockReturnValueOnce(late.promise); mount();
  expect(words()).toContain('Loading your communities'); expect(words()).not.toContain('Find your kind');
  await act(async () => { jest.advanceTimersByTime(12_000); }); await flush();
  expect(words()).toContain('Couldn’t load your communities'); expect(mockRead).toHaveBeenCalledTimes(1);
  mockRead.mockResolvedValueOnce([row]); act(() => action().props.onPress()); await flush();
  expect(words()).toContain(row.name); expect(words()).not.toContain('Couldn’t load');
  late.resolve([{ ...row, name: 'Retired result' }]); await flush();
  expect(words()).not.toContain('Retired result'); expect(mockRead).toHaveBeenCalledTimes(2);
});
it('distinguishes failed membership reads from an empty list and only shows exploration after success', async () => {
  mockRead.mockRejectedValueOnce(new Error('offline')); mount(); await flush();
  expect(words()).toContain('Couldn’t load'); expect(words()).not.toContain('Find your kind');
  act(() => action().props.onPress()); await flush();
  expect(words()).toContain('Find your kind of people'); act(() => action('Explore communities').props.onPress()); expect(mockBrowse).toHaveBeenCalledTimes(1);
});
it('retains cached cards during refresh failure with compact recovery and a single pending retry', async () => {
  client.setQueryData(['my-communities', 'alice', 1], [row]); mockRead.mockRejectedValueOnce(new Error('offline'));
  mount(); await flush(); expect(words()).toContain('Couldn’t refresh. Your communities are still here.');
  expect(words()).not.toContain('Couldn’t load your communities'); expect(words()).toContain(row.name); expect(words()).toContain('1 member'); expect(words()).toContain('Creator');
  const pending = deferred<any[]>(); mockRead.mockReturnValueOnce(pending.promise); const retry = action().props.onPress;
  act(() => { retry(); retry(); }); await flush(); expect(mockRead).toHaveBeenCalledTimes(2); expect(action('Retrying…').props.disabled).toBe(true);
  expect(words()).toContain(row.name); pending.resolve([row]); await flush(); expect(words()).not.toContain('Couldn’t refresh');
  act(() => open()()); expect(mockOpen).toHaveBeenCalledWith('sunday');
});
it('does not publish a read that crosses an account generation', async () => {
  const old = deferred<any[]>(); mockRead.mockReturnValueOnce(old.promise); mount();
  mockViewer = 'bob'; mockEpoch++; mockRead.mockResolvedValueOnce([{ ...row, id: 'bob-page', name: 'Bob community' }]); update(); await flush();
  old.resolve([row]); await flush(); expect(words()).toContain('Bob community'); expect(words()).not.toContain(row.name);
  expect(client.getQueryData(['my-communities', 'alice', 1])).toBeUndefined();
});
it.each(['account', 'unmount'])('retires open and refresh callbacks on %s', async retirement => {
  mockRead.mockResolvedValue([row]); mount(); await flush(); const oldOpen = open(); const oldRefresh = tree.root.findByType(RefreshControl).props.onRefresh;
  if (retirement === 'account') { mockViewer = null; mockEpoch++; update(); expect(words()).not.toContain(row.name); } else unmount();
  const before = mockRead.mock.calls.length; act(() => { oldOpen(); oldRefresh(); }); await flush();
  expect(mockOpen).not.toHaveBeenCalled(); expect(mockRead).toHaveBeenCalledTimes(before); expect(mockRetry).not.toHaveBeenCalled();
});
it.each(['account', 'unmount'])('retires browse callbacks on %s', async retirement => {
  mount(); await flush(); const browse = action('Explore communities').props.onPress;
  if (retirement === 'account') { mockViewer = null; mockEpoch++; update(); } else unmount();
  act(() => browse()); expect(mockBrowse).not.toHaveBeenCalled();
});
it('hides cached membership on account uncertainty and guards retained identity retry', async () => {
  client.setQueryData(['my-communities', 'alice', 1], [row]); mockAccountError = new Error('account unavailable'); mount();
  expect(words()).not.toContain(row.name); expect(mockRead).not.toHaveBeenCalled(); const retry = action().props.onPress;
  act(() => { retry(); retry(); }); expect(mockRetry).toHaveBeenCalledTimes(1); await flush();
  mockViewer = 'bob'; mockEpoch++; update(); act(() => retry()); expect(mockRetry).toHaveBeenCalledTimes(1);
});
it('ignores a pending result after unmount and lets a fresh visit read normally', async () => {
  const old = deferred<any[]>(); mockRead.mockReturnValueOnce(old.promise); mount(); unmount(); old.resolve([row]); await flush();
  expect(client.getQueryData(['my-communities', 'alice', 1])).toBeUndefined(); mockRead.mockResolvedValueOnce([]); mount(); await flush(); expect(words()).toContain('Find your kind');
});
it('preserves real media, compact no-cover identity, long names, roles and original destinations', async () => {
  const longName = 'The long way home along the coast with Sunday friends';
  mockRead.mockResolvedValue([{ ...row, name: longName }, { ...row, id: 'image', name: 'Photo community', role: 'co_leader', member_count: 12, cover_image: 'https://example.com/cover.jpg' }, { ...row, id: 'media', name: 'Media community', role: 'member', member_count: null, cover_media_id: 'media-id' }]);
  mount(); await flush(); expect(words()).toContain(longName); expect(words()).toContain('Co-creator'); expect(words()).toContain('12 members');
  expect(tree.root.findByType(Image).props.source).toEqual({ uri: 'https://example.com/cover.jpg' });
  expect(tree.root.findByType(PublishedPageCover).props).toMatchObject({ pageId: 'media', mediaId: 'media-id', height: 132 });
  expect(tree.root.findAllByType(Text).filter(n => n.props.accessible === false).map(n => n.props.children)).toEqual(['T']);
  act(() => { open(longName)(); open('Photo community')(); open('Media community')(); }); expect(mockOpen.mock.calls).toEqual([['sunday'], ['image'], ['media']]);
});
