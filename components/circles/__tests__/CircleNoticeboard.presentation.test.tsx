import React from 'react';
import { Text, StyleSheet, ScrollView } from 'react-native';
import { act, create } from 'react-test-renderer';
import CircleNoticeboard, { type CircleNoticeboardProps } from '../CircleNoticeboard';
import CircleMembersRow from '../CircleMembersRow';
import type { CirclePayload, CircleMember } from '../../../lib/circles/types';
import type { CirclePlanRow } from '../../../hooks/useCirclePlans';
import { AfterglowFallbackFonts } from '../../../constants/Typography';
const mockPush = jest.fn(), mockRefetch = jest.fn(), mockPlansHook = jest.fn(), mockSignedHook = jest.fn();
let mockPlans: CirclePlanRow[] = [], mockLoading = false, mockFetching = false, mockError = false, mockSigned: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-image', () => ({ Image: (props: any) => require('react').createElement('Photo', props) }));
jest.mock('lucide-react-native', () => Object.fromEntries(['CalendarDays', 'CalendarPlus', 'MessageCircle', 'UserPlus', 'Pencil', 'Image', 'Plus'].map(name => [name, (props: any) => require('react').createElement('Icon', { ...props, name })])));
jest.mock('../../../hooks/useCirclePlans', () => ({ useCirclePlans: (...args: unknown[]) => { mockPlansHook(...args); return { data: mockPlans, isLoading: mockLoading, isFetching: mockFetching, isError: mockError, refetch: mockRefetch }; } }));
jest.mock('../../../hooks/useSignedAlbumUrls', () => ({ useSignedAlbumUrls: (...args: unknown[]) => { mockSignedHook(...args); return { data: mockSigned }; } }));
jest.mock('../../../lib/circles/coverUrl', () => ({ buildCircleCoverUrl: (id: string, upload: string | null) => upload ? `https://example.invalid/cover/${id}/${upload}` : null }));
const appearance = { fonts: AfterglowFallbackFonts };
const person = (id: string, firstName: string | null = id, photo: string | null = null): CircleMember => ({ user_id: id, role: 'member', joined_at: '2026-01-01', first_name_display: firstName, last_name: null, handle: `${id}.local`, profile_photo_url: photo });
const payload = (): CirclePayload => ({ circle: { id: 'circle-a', name: 'Sunday people', description: 'Walks, then coffee. Come as you are.', creator_user_id: 'creator', cover_upload_id: 'manual', status: 'active', room_enabled: false, created_at: '2026-01-01', updated_at: '2026-01-01' }, members: [person('Amelia', 'Amelia', 'https://example.invalid/amelia.jpg'), person('Jamie')], pinned_plan: null, recent_together: [{ upload_id: 'newest', media_path: 'private/newest.jpg', content_type: 'image/jpeg', created_at: '2026-09-13', user_id: 'Amelia', first_name_display: 'Amelia', profile_photo_url: null }] });
const plan = (id: string, overrides: Partial<CirclePlanRow> = {}): CirclePlanRow => ({ id, title: `Plan ${id}`, start_time: '2026-09-20T17:00:00Z', location_text: 'Ocean Park, Santa Monica', circle_visibility: 'circle_only', has_own_chat: true, member_count: 0, stranger_cap: null, ...overrides });
const cleanups: Array<() => void> = [];
function mount(element: React.ReactElement) {
  let tree!: ReturnType<typeof create>; act(() => { tree = create(element); }); cleanups.push(() => act(() => tree.unmount()));
  return { tree, update: (next: React.ReactElement) => act(() => tree.update(next)), photos: () => tree.root.findAllByType('Photo' as any),
    text: () => tree.root.findAllByType(Text).flatMap(n => n.props.children).filter(n => typeof n !== 'object').join(' ').replace(/\s+/g, ' ').trim(),
    button: (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0] };
}
function board(extra: Partial<CircleNoticeboardProps> = {}) { return <CircleNoticeboard payload={payload()} appearance={appearance} {...extra}/>; }
beforeEach(() => { mockPlans = []; mockLoading = false; mockFetching = false; mockError = false; mockSigned = { 'private/newest.jpg': 'https://example.invalid/signed-newest.jpg' }; mockRefetch.mockResolvedValue(undefined); });
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); jest.clearAllMocks(); });
it('preserves the manual > signed newest > monogram ladder while showing the title outside the photo', () => {
  const f = mount(board()); const original = f.photos()[0]; expect(original.props.source.uri).toContain('/circle-a/manual');
  expect(StyleSheet.flatten(original.props.style)).toMatchObject({ opacity: 1 });
  const title = f.tree.root.findAllByType(Text).find(n => n.props.children === 'Sunday people')!; expect(title.props.numberOfLines).toBeUndefined();
  act(() => original.props.onError()); expect(f.photos()[0].props.source.uri).toBe(mockSigned['private/newest.jpg']);
  act(() => f.photos()[0].props.onError()); expect(f.photos().some(n => n.props.source.uri.includes('/cover/'))).toBe(false); expect(f.text()).toContain('S');
});
it('a replacement manual photo and a different circle are not poisoned by old image callbacks', () => {
  const f = mount(board()), oldError = f.photos()[0].props.onError; act(() => oldError());
  const next = payload(); next.circle.cover_upload_id = 'replacement'; f.update(board({ payload: next })); act(() => oldError()); expect(f.photos()[0].props.source.uri).toContain('/replacement');
  next.circle = { ...next.circle, id: 'circle-b' }; f.update(board({ payload: next })); act(() => oldError()); expect(f.photos()[0].props.source.uri).toContain('/circle-b/');
});
it('uses only the newest signed shared photo when there is no manual cover and never treats a storage path as a URL', () => {
  const data = payload(); data.circle.cover_upload_id = null;
  const f = mount(board({ payload: data })); expect(f.photos()[0].props.source.uri).toBe(mockSigned['private/newest.jpg']);
  expect(mockSignedHook).toHaveBeenCalledWith(['private/newest.jpg']);
  mockSigned = {}; f.update(board({ payload: data })); expect(f.photos().every(n => !n.props.source.uri.startsWith('private/'))).toBe(true);
});
it('keeps plan title, date, place and two separate capacity facts readable and leaves routes unchanged', () => {
  const title = 'A long plan title that remains completely readable on a small phone', place = 'A deliberately long meeting place near the Santa Monica entrance';
  mockPlans = [plan('open', { title, location_text: place, circle_visibility: 'open', stranger_cap: 7 }), plan('private', { stranger_cap: 7 }), plan('other-open', { circle_visibility: 'open', stranger_cap: 6 })];
  const data = payload(); data.pinned_plan = { id: 'open', title, start_time: mockPlans[0].start_time, image_url: null, circle_size: 8, circle_in_count: 3 };
  const f = mount(board({ payload: data }));
  expect(f.text()).toContain('Up to 7 others welcome'); expect(f.text()).toContain('Up to 6 others welcome'); expect(f.text()).toContain('3 of 8 circle members going'); expect(f.text()).toContain('Private to circle'); expect(f.text()).not.toContain('spots left');
  for (const copy of [title, place, 'Up to 7 others welcome']) expect(f.tree.root.findAllByType(Text).find(n => n.props.children === copy)?.props.numberOfLines).toBeUndefined();
  act(() => f.button(`View plan, ${title}`).props.onPress()); expect(mockPush).toHaveBeenCalledWith('/plan/open');
});
it('only the matched pinned plan shows the supplied circle participation count', () => {
  mockPlans = [plan('one'), plan('two')]; const data = payload(); data.pinned_plan = { id: 'gone', title: 'Gone', start_time: '', image_url: null, circle_size: 99, circle_in_count: 25 };
  const f = mount(board({ payload: data })); expect(f.text()).not.toContain('25 of 99');
});
it('does not promise privacy or outsider availability when the audience metadata is missing', () => {
  mockPlans = [plan('unknown', { circle_visibility: null, stranger_cap: 7 })];
  const f = mount(board()); expect(f.text()).toContain('Circle plan'); expect(f.text()).not.toContain('Private to circle'); expect(f.text()).not.toContain('others welcome');
  act(() => f.button('View plan, Plan unknown').props.onPress()); expect(mockPush).toHaveBeenCalledWith('/plan/unknown');
});
it('preserves exact callbacks, the plans hook scope, and current plan-list ownership', () => {
  const onOpenPlan = jest.fn(), onPostPlan = jest.fn(), onOpenChat = jest.fn(), onAddPeople = jest.fn(), onNameCircle = jest.fn();
  const plansScope = { userId: 'viewer', epoch: 2, isCurrent: () => true }; mockPlans = [plan('one')];
  const f = mount(board({ onOpenPlan, onPostPlan, onOpenChat, onAddPeople, onNameCircle, plansScope }));
  expect(mockPlansHook).toHaveBeenCalledWith('circle-a', plansScope);
  ['Make a plan', 'Open chat', 'Invite', 'Name this circle'].forEach(label => act(() => f.button(label).props.onPress()));
  [onPostPlan, onOpenChat, onAddPeople, onNameCircle].forEach(callback => expect(callback).toHaveBeenCalledTimes(1));
  const open = f.button('View plan, Plan one').props.onPress; act(() => open()); expect(onOpenPlan).toHaveBeenCalledWith('one'); expect(mockPush).not.toHaveBeenCalled();
  mockPlans = []; f.update(board({ onOpenPlan })); act(() => open()); expect(onOpenPlan).toHaveBeenCalledTimes(1);
});
it('retires actions after a circle round trip or an external account/visit scope expires', () => {
  let current = true; const operationScope = { isCurrent: () => current }, onPostPlan = jest.fn();
  const f = mount(board({ operationScope, onPostPlan })), oldPost = f.button('Make a plan').props.onPress;
  const second = payload(); second.circle.id = 'circle-b'; f.update(board({ payload: second, operationScope, onPostPlan })); f.update(board({ operationScope, onPostPlan })); act(() => oldPost()); expect(onPostPlan).not.toHaveBeenCalled();
  const currentPost = f.button('Make a plan').props.onPress; current = false; act(() => currentPost()); expect(onPostPlan).not.toHaveBeenCalled();
});
it('distinguishes loading, error and retry from a genuinely empty upcoming list', async () => {
  mockLoading = true; const f = mount(board({ onPostPlan: jest.fn() })); expect(f.text()).toContain('Loading plans'); expect(f.text()).not.toMatch(/No plans on the calendar|No plans yet/);
  mockLoading = false; mockError = true; f.update(board({ onPostPlan: jest.fn() })); expect(f.text()).toContain('Couldn’t load plans'); expect(f.text()).not.toMatch(/No plans on the calendar|No plans yet/);
  const retry = f.button('Try again to load circle plans').props.onPress; act(() => { retry(); retry(); }); expect(mockRefetch).toHaveBeenCalledTimes(1);
  await act(async () => { await Promise.resolve(); }); mockError = false; f.update(board({ onPostPlan: jest.fn() })); expect(f.text()).toContain('No plans yet'); expect(f.button('Make a plan')).toBeTruthy();
});
it('failed recent photos retain a stable noninteractive fallback; renewed URLs recover', () => {
  const f = mount(board()); const recent = f.photos().find(n => StyleSheet.flatten(n.props.style)?.width === 84)!; const oldError = recent.props.onError;
  act(() => oldError()); expect(f.tree.root.findAll(n => n.props.accessibilityLabel === 'Shared photo unavailable').length).toBeGreaterThan(0);
  mockSigned = { 'private/newest.jpg': 'https://example.invalid/refreshed.jpg' }; f.update(board()); act(() => oldError()); expect(f.photos().some(n => n.props.source.uri.endsWith('/refreshed.jpg'))).toBe(true);
});
it('staged member faces are full color and remain read-only with a separate Add action', () => {
  const data = [person('a', 'Amelia', 'https://example.invalid/a.jpg'), person('b', 'A very long first name')], onAdd = jest.fn();
  const f = mount(<CircleMembersRow members={data} appearance={appearance} onAdd={onAdd}/>);
  expect(StyleSheet.flatten(f.photos()[0].props.style)).toMatchObject({ width: 44, height: 44, opacity: 1 });
  expect(f.tree.root.findAll(n => n.props.accessibilityLabel === 'Amelia' && n.props.onPress)).toHaveLength(0);
  act(() => f.button('Add people').props.onPress()); expect(onAdd).toHaveBeenCalledTimes(1);
  expect(f.tree.root.findByType(ScrollView).props.horizontal).toBe(true);
});
it('member photo failure uses the correct initial and does not poison replacement or identity', () => {
  const f = mount(<CircleMembersRow members={[person('a', 'Amelia', 'https://example.invalid/broken.jpg')]} appearance={appearance}/>), oldError = f.photos()[0].props.onError;
  act(() => oldError()); expect(f.photos()).toHaveLength(0); expect(f.text()).toContain('A');
  f.update(<CircleMembersRow members={[person('a', 'Amelia', 'https://example.invalid/new.jpg')]} appearance={appearance}/>); act(() => oldError()); expect(f.photos()[0].props.source.uri).toContain('/new.jpg');
  f.update(<CircleMembersRow members={[person('b', 'Bea', 'https://example.invalid/broken.jpg')]} appearance={appearance}/>); act(() => oldError()); expect(f.photos()).toHaveLength(1); expect(f.text()).toContain('Bea');
});
it('legacy presentation remains opt-out while read failures are still honest', () => {
  mockError = true; const f = mount(board({ appearance: undefined })); expect(f.text()).toContain('Couldn’t load plans'); expect(f.text()).not.toMatch(/No plans on the calendar|No plans yet/);
});


it.each(['staged', 'legacy'] as const)('%s waits for a deferred cached-empty refresh before inviting another plan', async mode => {
  const props = { appearance: mode === 'staged' ? appearance : undefined, onPostPlan: jest.fn() };
  const emptyCopy = mode === 'staged' ? 'No plans yet' : 'No plans on the calendar';
  const f = mount(board(props)); expect(f.text()).toContain(emptyCopy);
  let finish!: () => void;
  const refresh = new Promise<void>(resolve => { finish = resolve; }).then(() => {
    mockFetching = false;
    f.update(board(props));
  });
  mockFetching = true; f.update(board(props));
  expect(f.text()).toContain('Loading plans');
  expect(f.text()).not.toMatch(/No plans on the calendar|No plans yet/);
  // Staged creation remains in the permanent action bar; only legacy has an empty-state CTA.
  expect(f.button('Make the first plan.')).toBeUndefined();
  await act(async () => { finish(); await refresh; });
  expect(f.text()).not.toContain('Loading plans'); expect(f.text()).toContain(emptyCopy);
});

it.each(['staged', 'legacy'] as const)('%s keeps existing rows readable while the plan list refreshes', mode => {
  mockPlans = [plan('saved')]; mockFetching = true;
  const f = mount(board({ appearance: mode === 'staged' ? appearance : undefined }));
  expect(f.text()).toContain('Plan saved'); expect(f.text()).not.toContain('Loading plans');
  expect(f.text()).not.toMatch(/No plans on the calendar|No plans yet/);
});
