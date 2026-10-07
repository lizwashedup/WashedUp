import React from 'react';
import { ActivityIndicator, SectionList, Text } from 'react-native';
import { Image } from 'expo-image';
import { AfterglowFallbackFonts } from '../../../constants/Typography';
import PeopleSearchBar from '../../yours/search/PeopleSearchBar';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import PeoplePickerSheet from '../PeoplePickerSheet';
import { useObservedUser } from '../../../hooks/useObservedUser';
import { useYoursGrid } from '../../../hooks/useYoursGrid';
import type { YoursGridPerson } from '../../../lib/yours/types';

jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: jest.fn() }));
jest.mock('../../../hooks/useYoursGrid', () => ({ useYoursGrid: jest.fn() }));
jest.mock('../../../lib/haptics', () => ({ hapticSelection: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('lucide-react-native', () => ({ Check: () => null, X: () => null, Search: () => null }));
const observed = jest.mocked(useObservedUser), grid = jest.mocked(useYoursGrid);
const retryIdentity = jest.fn(), retryPeople = jest.fn();
let identity: ReturnType<typeof useObservedUser>;
let query: Record<string, unknown>;
let currentEpoch = 1;
const cleanup: Array<() => void> = [];
function person(id: string): YoursGridPerson {
  return { user_id: id, first_name_display: id, profile_photo_url: `mock:${id}`, handle: null, ring_bucket: 'none', shared_count: 0,
    milestone: null, upcoming_event_id: null, upcoming_title: null, upcoming_start: null, upcoming_neighborhood: null, connected_at: '2026-09-12' };
}
function account(id = 'viewer') {
  const epoch = currentEpoch;
  return { viewerId: id, epoch, error: null, isLoading: false, retry: retryIdentity, isCurrent: () => epoch === currentEpoch };
}
function mount(appearance?: { fonts: typeof AfterglowFallbackFonts }) {
  const onConfirm = jest.fn(), onClose = jest.fn();
  let tree!: ReturnType<typeof create>;
  const element = (visible = true, excludeIds: string[] = []) => <PeoplePickerSheet visible={visible} excludeIds={excludeIds} onConfirm={onConfirm} onClose={onClose} appearance={appearance} />;
  act(() => { tree = create(element()); });
  cleanup.push(() => act(() => tree.unmount()));
  return { tree, onConfirm, onClose, update: (visible = true, excludeIds: string[] = []) => act(() => tree.update(element(visible, excludeIds))) };
}
function action(root: ReactTestInstance, label: string) {
  return root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
}
function select(root: ReactTestInstance, id: string) { act(() => action(root, id).props.onPress()); }
beforeEach(() => {
  jest.clearAllMocks(); currentEpoch = 1; identity = account();
  query = { data: [person('alice'), person('bob')], isSuccess: true, isLoading: false, isFetching: false, refetch: retryPeople };
  observed.mockImplementation(() => identity);
  grid.mockImplementation(() => query as unknown as ReturnType<typeof useYoursGrid>);
});
afterEach(() => cleanup.splice(0).forEach(close => close()));

it('keeps identity loading distinct from an empty people list', () => {
  identity = { ...identity, viewerId: undefined, isLoading: true };
  const fixture = mount();
  expect(grid).toHaveBeenLastCalledWith(undefined);
  expect(fixture.tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(action(fixture.tree.root, 'Add 1 person')).toBeUndefined();
  expect(fixture.onConfirm).not.toHaveBeenCalled();
});

it.each(['identity', 'people'])('shows a retry for %s failure and does not report a successful empty list', async kind => {
  if (kind === 'identity') identity = { ...identity, error: new Error('offline') };
  else query = { ...query, data: undefined, isSuccess: false };
  const fixture = mount();
  const retry = action(fixture.tree.root, 'Retry loading your people');
  expect(retry).toBeDefined();
  await act(async () => retry.props.onPress());
  expect(kind === 'identity' ? retryIdentity : retryPeople).toHaveBeenCalledTimes(1);
  expect(fixture.onConfirm).not.toHaveBeenCalled();
  expect(fixture.onClose).not.toHaveBeenCalled();
});

it('confirms the actual selected person once, preserving their photo and checkbox state', () => {
  const fixture = mount();
  select(fixture.tree.root, 'alice');
  expect(action(fixture.tree.root, 'alice').props['aria-checked']).toBe(true);
  const confirm = action(fixture.tree.root, 'Add 1 person').props.onPress;
  act(() => { confirm(); confirm(); });
  expect(fixture.onConfirm).toHaveBeenCalledTimes(1);
  expect(fixture.onConfirm).toHaveBeenCalledWith([{ user_id: 'alice', name: 'alice', photo: 'mock:alice' }]);
  expect(fixture.onClose).toHaveBeenCalledTimes(1);
});

it.each(['excluded', 'removed', 'read-error'])('does not confirm a stale selection after it becomes %s', reason => {
  const fixture = mount();
  select(fixture.tree.root, 'alice');
  const oldConfirm = action(fixture.tree.root, 'Add 1 person').props.onPress;
  if (reason === 'excluded') fixture.update(true, ['alice']);
  else {
    query = reason === 'removed' ? { ...query, data: [person('bob')] } : { ...query, isSuccess: false };
    fixture.update();
  }
  act(() => oldConfirm());
  expect(fixture.onConfirm).not.toHaveBeenCalled();
  expect(action(fixture.tree.root, 'Add 1 person')).toBeUndefined();
});

it('clears selections when closed externally, reopened, or switched to another account', () => {
  const fixture = mount();
  select(fixture.tree.root, 'alice');
  fixture.update(false);
  fixture.update(true);
  expect(action(fixture.tree.root, 'alice').props['aria-checked']).toBe(false);
  select(fixture.tree.root, 'alice');
  const oldConfirm = action(fixture.tree.root, 'Add 1 person').props.onPress;
  currentEpoch++;
  identity = account('other');
  fixture.update();
  act(() => oldConfirm());
  expect(action(fixture.tree.root, 'alice').props['aria-checked']).toBe(false);
  expect(fixture.onConfirm).not.toHaveBeenCalled();
});

it('keeps suggested ranking limited to real shared plans and never duplicates people across sections', () => {
  query = { ...query, data: [{ ...person('alice'), shared_count: 4 }, person('bob')] };
  const fixture = mount();
  const sections = fixture.tree.root.findByType(SectionList).props.sections;
  expect(sections[0].title).toBe('Suggested');
  expect(sections[0].data.map((p: YoursGridPerson) => p.user_id)).toEqual(['alice']);
  expect(sections.flatMap((section: { data: YoursGridPerson[] }) => section.data.map(p => p.user_id))).toEqual(['alice', 'bob']);
});

it('does not carry a pending identity retry into another account', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>(yes => { resolve = yes; });
  retryIdentity.mockReturnValueOnce(pending);
  identity = { ...identity, error: new Error('identity read failed') };
  const fixture = mount();
  act(() => action(fixture.tree.root, 'Retry loading your people').props.onPress());
  currentEpoch++;
  identity = account('other');
  query = { ...query, data: [person('other-person')] };
  fixture.update();
  expect(action(fixture.tree.root, 'other-person')).toBeDefined();
  expect(fixture.tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  await act(async () => { resolve(); await pending; });
  expect(action(fixture.tree.root, 'other-person')).toBeDefined();
});


it('retires Confirm and selection immediately on Close before the parent removes the sheet', () => {
  const fixture = mount(); select(fixture.tree.root, 'alice');
  const confirm = action(fixture.tree.root, 'Add 1 person').props.onPress;
  const close = action(fixture.tree.root, 'Cancel').props.onPress;
  act(() => { close(); confirm(); close(); });
  expect(fixture.onConfirm).not.toHaveBeenCalled(); expect(fixture.onClose).toHaveBeenCalledTimes(1);
});
it('does not close a replacement account sheet through a retained old Close callback', () => {
  const fixture = mount(); const close = action(fixture.tree.root, 'Cancel').props.onPress;
  currentEpoch++; identity = account('other'); fixture.update();
  act(() => close()); expect(fixture.onClose).not.toHaveBeenCalled();
});
it('keeps a rejected retry inside the current error state and allows another attempt', async () => {
  query = { ...query, data: undefined, isSuccess: false };
  retryPeople.mockRejectedValueOnce(new Error('offline'));
  const fixture = mount(); await act(async () => action(fixture.tree.root, 'Retry loading your people').props.onPress());
  expect(fixture.onConfirm).not.toHaveBeenCalled(); expect(fixture.onClose).not.toHaveBeenCalled();
  expect(action(fixture.tree.root, 'Retry loading your people')).toBeDefined();
  await act(async () => action(fixture.tree.root, 'Retry loading your people').props.onPress()); expect(retryPeople).toHaveBeenCalledTimes(2);
});
it('shows only supplied handles in the optional rows and returns the original selected identity', () => {
  query = { ...query, data: [{ ...person('alice'), first_name_display: 'Amelia', handle: ' @@amelialocal ' }, person('bob')] };
  const fixture = mount({ fonts: AfterglowFallbackFonts });
  expect(action(fixture.tree.root, 'Add people').props.disabled).toBe(true);
  const handles = fixture.tree.root.findAllByType(Text).filter(node => String(node.props.children).includes('@'));
  expect(handles.map(node => node.props.children)).toEqual([['@', 'amelialocal']]);
  select(fixture.tree.root, 'Amelia, @amelialocal'); act(() => action(fixture.tree.root, 'Add 1 person').props.onPress());
  expect(fixture.onConfirm).toHaveBeenCalledWith([{ user_id: 'alice', name: 'Amelia', photo: 'mock:alice', handle: 'amelialocal' }]);
});
it('preserves local handle filtering and keeps selected people visible during search', () => {
  query = { ...query, data: Array.from({ length: 12 }, (_, index) => ({ ...person(`person-${index}`), handle: `handle_${index}` })) };
  const appearance = { fonts: AfterglowFallbackFonts }; const fixture = mount(appearance);
  select(fixture.tree.root, 'person-1, @handle_1');
  const search = fixture.tree.root.findByType(PeopleSearchBar); expect(search.props.appearance).toBe(appearance);
  act(() => search.props.onChange('@handle_8'));
  const sections = fixture.tree.root.findByType(SectionList).props.sections;
  expect(sections.flatMap((section: { data: YoursGridPerson[] }) => section.data.map(p => p.user_id))).toEqual(['person-1', 'person-8']);
});
it('uses a real-name initial for an unavailable portrait and ignores a prior photo failure after replacement', () => {
  const fixture = mount({ fonts: AfterglowFallbackFonts });
  const originalImage = fixture.tree.root.findAllByType(Image).find(node => node.props.source.uri === 'mock:alice')!;
  const oldFailure = originalImage.props.onError; act(() => oldFailure());
  expect(fixture.tree.root.findAllByType(Image).some(node => node.props.source.uri === 'mock:alice')).toBe(false);
  expect(fixture.tree.root.findAllByType(Text).some(node => node.props.children === 'A')).toBe(true);
  query = { ...query, data: [{ ...person('alice'), profile_photo_url: 'mock:new-photo' }, person('bob')] }; fixture.update();
  act(() => oldFailure()); expect(fixture.tree.root.findAllByType(Image).some(node => node.props.source.uri === 'mock:new-photo')).toBe(true);
});

it('clears the visible filter when a refreshed list becomes small enough to hide search', () => {
  query = { ...query, data: Array.from({ length: 12 }, (_, index) => ({ ...person(`person-${index}`), handle: `handle_${index}` })) };
  const fixture = mount({ fonts: AfterglowFallbackFonts });
  act(() => fixture.tree.root.findByType(PeopleSearchBar).props.onChange('@handle_8'));
  query = { ...query, data: [person('alice'), person('bob')] }; fixture.update();
  expect(fixture.tree.root.findAllByType(PeopleSearchBar)).toHaveLength(0);
  const sections = fixture.tree.root.findByType(SectionList).props.sections;
  expect(sections.flatMap((section: { data: YoursGridPerson[] }) => section.data.map(p => p.user_id))).toEqual(['alice', 'bob']);
});
