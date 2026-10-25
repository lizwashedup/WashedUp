import React from 'react';
import { act, create } from 'react-test-renderer';
import { ActivityIndicator, Modal, Platform } from 'react-native';
import PingAfterPlanModal from '../PingAfterPlanModal';
import PingInline from '../PingInline';
import { useObservedUser } from '../../../../hooks/useObservedUser';
import { useYoursGrid } from '../../../../hooks/useYoursGrid';

jest.mock('../PingInline', () => ({ __esModule: true, default: jest.fn(() => null) }));
jest.mock('../../../../hooks/useObservedUser', () => ({ useObservedUser: jest.fn() }));
jest.mock('../../../../hooks/useYoursGrid', () => ({ useYoursGrid: jest.fn() }));

const observed = jest.mocked(useObservedUser);
const grid = jest.mocked(useYoursGrid);
const retryIdentity = jest.fn();
const retryPeople = jest.fn();
const currentIdentity = jest.fn(() => true);
let identity: ReturnType<typeof useObservedUser>;
let people: Record<string, unknown>;
const cleanup: Array<() => void> = [];

function mount(id: string | null = 'plan-a') {
  const done = jest.fn();
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<PingAfterPlanModal planId={id} onDone={done} />); });
  let unmounted = false;
  const unmount = () => { if (!unmounted) act(() => renderer.unmount()); unmounted = true; };
  cleanup.push(unmount);
  return { done, renderer, unmount, refresh: (nextId = id) => act(() => renderer.update(<PingAfterPlanModal planId={nextId} onDone={done} />)) };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  currentIdentity.mockReturnValue(true);
  identity = { viewerId: 'alice', epoch: 1, error: null, isLoading: false, retry: retryIdentity, isCurrent: currentIdentity };
  people = { data: [{ user_id: 'bob' }], isSuccess: true, isLoading: false, isFetching: false, refetch: retryPeople };
  observed.mockImplementation(() => identity);
  grid.mockImplementation(() => people as unknown as ReturnType<typeof useYoursGrid>);
});
afterEach(() => { cleanup.splice(0).forEach(close => close()); jest.restoreAllMocks(); });

it('does not mount account or people reads when no invitation step is open', () => {
  const fixture = mount(null);
  expect(observed).not.toHaveBeenCalled();
  expect(grid).not.toHaveBeenCalled();
  expect(fixture.done).not.toHaveBeenCalled();
});

it('keeps initial identity and people loading visible instead of dismissing', () => {
  identity = { ...identity, viewerId: undefined, isLoading: true };
  people = { ...people, data: undefined, isSuccess: false, isLoading: false };
  const fixture = mount();
  expect(fixture.renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(fixture.done).not.toHaveBeenCalled();
  identity = { ...identity, viewerId: 'alice', isLoading: false };
  people = { ...people, isLoading: true };
  fixture.refresh();
  expect(fixture.renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(fixture.done).not.toHaveBeenCalled();
});

it('retries identity failures and keeps an explicit continue action', async () => {
  identity = { ...identity, viewerId: undefined, error: new Error('Unavailable') };
  people = { ...people, data: undefined, isSuccess: false };
  const fixture = mount();
  const retry = fixture.renderer.root.findAll(node => node.props.accessibilityLabel === 'Retry loading your people' && typeof node.props.onPress === 'function')[0];
  await act(async () => { await retry.props.onPress(); });
  expect(retryIdentity).toHaveBeenCalledTimes(1);
  expect(fixture.done).not.toHaveBeenCalled();
  act(() => fixture.renderer.root.findAll(node => node.props.accessibilityLabel === 'Continue without inviting' && typeof node.props.onPress === 'function')[0].props.onPress());
  // Native dismissal must finish before the caller can navigate.
  act(() => fixture.renderer.root.findByType(Modal).props.onRequestClose());
  expect(fixture.done).not.toHaveBeenCalled();
  act(() => fixture.renderer.root.findByType(Modal).props.onDismiss());
  expect(fixture.done).toHaveBeenCalledTimes(1);
});

it('does not treat a people error as an empty list and retries the people read', async () => {
  people = { ...people, data: undefined, isSuccess: false };
  const fixture = mount();
  expect(fixture.done).not.toHaveBeenCalled();
  await act(async () => {
    await fixture.renderer.root.findAll(node => node.props.accessibilityLabel === 'Retry loading your people' && typeof node.props.onPress === 'function')[0].props.onPress();
  });
  expect(retryPeople).toHaveBeenCalledTimes(1);
  expect(retryIdentity).not.toHaveBeenCalled();
});

it('waits for an empty-list refresh before skipping the optional step exactly once', () => {
  people = { ...people, data: [], isFetching: true };
  const fixture = mount();
  expect(fixture.done).not.toHaveBeenCalled();
  expect(fixture.renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  people = { ...people, isFetching: false };
  fixture.refresh();
  fixture.refresh();
  expect(fixture.done).not.toHaveBeenCalled();
  act(() => fixture.renderer.root.findByType(Modal).props.onDismiss());
  expect(fixture.done).toHaveBeenCalledTimes(1);
});

it('prevents Android back dismissal during sending, including before state renders', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const fixture = mount();
  const inline = fixture.renderer.root.findByType(PingInline);
  const requestClose = fixture.renderer.root.findByType(Modal).props.onRequestClose;
  act(() => { inline.props.onBusyChange(true); requestClose(); });
  expect(fixture.done).not.toHaveBeenCalled();
  act(() => { inline.props.onBusyChange(false); requestClose(); });
  // No native dismissal event is required to notify the parent.

  expect(fixture.done).toHaveBeenCalledTimes(1);
});

it('remounts the picker when the plan or account epoch changes', () => {
  const fixture = mount();
  const first = fixture.renderer.root.findByType(PingInline);
  fixture.refresh('plan-b');
  const second = fixture.renderer.root.findByType(PingInline);
  expect(second).not.toBe(first);
  identity = { ...identity, viewerId: 'bob', epoch: 2 };
  fixture.refresh('plan-b');
  expect(fixture.renderer.root.findByType(PingInline)).not.toBe(second);
});

it('ignores an old picker completion after unmount or an account event', () => {
  const fixture = mount();
  const finish = fixture.renderer.root.findByType(PingInline).props.onDone;
  currentIdentity.mockReturnValue(false);
  act(() => finish());
  expect(fixture.done).not.toHaveBeenCalled();
  currentIdentity.mockReturnValue(true);
  fixture.unmount();
  act(() => finish());
  expect(fixture.done).not.toHaveBeenCalled();
});


it('keeps the same native window when loading becomes a populated invitation', () => {
  people = { ...people, data: undefined, isSuccess: false, isLoading: true };
  const fixture = mount();
  const window = fixture.renderer.root.findByType(Modal);
  people = { ...people, data: [{ user_id: 'bob' }], isSuccess: true, isLoading: false };
  fixture.refresh();
  expect(fixture.renderer.root.findByType(Modal)).toBe(window);
});

it('waits for native iOS dismissal before continuing from an empty People response', () => {
  const os = Platform.OS; Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  try {
    people = { ...people, data: undefined, isSuccess: false, isLoading: true };
    const fixture = mount();
    people = { ...people, data: [], isSuccess: true, isLoading: false };
    fixture.refresh();
    expect(fixture.done).not.toHaveBeenCalled();
    const modal = fixture.renderer.root.findByType(Modal);
    expect(modal.props.visible).toBe(false);
    act(() => modal.props.onDismiss());
    act(() => modal.props.onDismiss());
    expect(fixture.done).toHaveBeenCalledTimes(1);
  } finally { Object.defineProperty(Platform, 'OS', { value: os, configurable: true }); }
});

it('retires a pending iOS dismissal when the account changes', () => {
  const os = Platform.OS; Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  try {
    const fixture = mount();
    act(() => fixture.renderer.root.findByType(PingInline).props.onDone());
    expect(fixture.done).not.toHaveBeenCalled();
    const dismiss = fixture.renderer.root.findByType(Modal).props.onDismiss;
    currentIdentity.mockReturnValue(false);
    act(() => dismiss());
    expect(fixture.done).not.toHaveBeenCalled();
  } finally { Object.defineProperty(Platform, 'OS', { value: os, configurable: true }); }
});


it('skips a cached empty result without waiting for a window that was never shown', () => {
  people = { ...people, data: [] };
  const fixture = mount();
  expect(fixture.done).toHaveBeenCalledTimes(1);
  fixture.refresh();
  expect(fixture.done).toHaveBeenCalledTimes(1);
});

it('ignores a pending dismissal after its invitation session unmounts', () => {
  const fixture = mount();
  act(() => fixture.renderer.root.findByType(PingInline).props.onDone());
  const dismiss = fixture.renderer.root.findByType(Modal).props.onDismiss;
  fixture.unmount();
  act(() => dismiss());
  expect(fixture.done).not.toHaveBeenCalled();
});
