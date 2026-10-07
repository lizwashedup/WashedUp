import React from 'react';
import { Animated } from 'react-native';
import { Image } from 'expo-image';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import PingInline from '../PingInline';
import PingSheet from '../PingSheet';
import InvitationPerson from '../InvitationPerson';
import { hapticSuccess } from '../../../../lib/haptics';
import { COPY, PING_AUTOFADE_MS } from '../../state/constants';
import type { YoursGridPerson } from '../../../../lib/yours/types';

const mockPing = jest.fn();
let mockPeople: YoursGridPerson[];
jest.mock('../../../../hooks/useYoursGrid', () => ({ useYoursGrid: () => ({ data: mockPeople }) }));
jest.mock('../../../../hooks/usePeopleConnectionMutations', () => ({ usePeopleConnectionMutations: () => ({ ping: { mutateAsync: mockPing } }) }));
jest.mock('../../../../lib/haptics', () => ({ hapticSelection: jest.fn(), hapticSuccess: jest.fn() }));
jest.mock('../../a11y/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('lucide-react-native', () => ({ Check: () => null }));

function person(id: string, name: string): YoursGridPerson {
  return { user_id: id, first_name_display: name, profile_photo_url: `mock:${id}`, handle: null,
    ring_bucket: 'none', shared_count: 0, milestone: null, upcoming_event_id: null, upcoming_title: null,
    upcoming_start: null, upcoming_neighborhood: null, connected_at: '2026-09-12' };
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() {
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
}
const cleanup: Array<() => void> = [];
function mount() {
  const onDone = jest.fn(), onBusyChange = jest.fn();
  let view!: ReturnType<typeof create>;
  let stopped = false;
  const tree = (userId = 'viewer', planId = 'plan') => <PingInline userId={userId} planId={planId} onDone={onDone} onBusyChange={onBusyChange} />;
  act(() => { view = create(tree()); });
  const unmount = () => { if (!stopped) act(() => view.unmount()); stopped = true; };
  cleanup.push(unmount);
  return { onDone, onBusyChange, view, unmount, update: (userId = 'viewer', planId = 'plan') => act(() => view.update(tree(userId, planId))) };
}
function button(root: ReactTestInstance, label: string) {
  return root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function').find(node => node.findAll(text => text.props.children === label).length > 0)!;
}
function checkbox(root: ReactTestInstance, name: string) {
  return root.findAll(node => node.props.accessibilityRole === 'checkbox' && node.props.accessibilityLabel === name && typeof node.props.onPress === 'function')[0];
}
const press = (node: ReactTestInstance) => act(() => node.props.onPress());

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockPeople = [person('alice', 'Alice'), person('bob', 'Bob')];
  mockPing.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: callback => callback?.({ finished: true }), stop: jest.fn(), reset: jest.fn() }));
});
afterEach(() => {
  cleanup.splice(0).forEach(close => close());
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('one accessible checkbox owns each photo and name, and toggling enables and disables sending', () => {
  const fixture = mount();
  expect(button(fixture.view.root, COPY.pingButton).props.disabled).toBe(true);
  const alice = fixture.view.root.findAllByType(InvitationPerson).find(item => item.props.inline && item.props.person.user_id === 'alice')!;
  expect(alice.findAll(text => text.props.children === 'Alice').length > 0).toBe(true);
  expect(alice.findAll(view => view.props.pointerEvents === 'none' && view.props.importantForAccessibility === 'no-hide-descendants').length > 0).toBe(true);
  expect(alice.findAll(node => node.props.accessibilityRole === 'button')).toHaveLength(0);
  expect(alice.findAll(node => node.props.accessibilityLabel === 'No shared plans yet')).toHaveLength(0);
  const selectionTargets = alice.findAll(node => node.props.accessibilityRole === 'checkbox');
  const leafTargets = selectionTargets.filter(node => !node.findAll(child => child !== node && child.props.accessibilityRole === 'checkbox').length);
  expect(leafTargets).toHaveLength(1);
  expect(alice.findByType(Image).props.source).toEqual({ uri: 'mock:alice' });
  expect(alice.findByType(Image).props.accessible).toBe(false);
  press(checkbox(fixture.view.root, 'Alice'));
  expect(checkbox(fixture.view.root, 'Alice').props.accessibilityState).toEqual({ checked: true, disabled: false });
  expect(checkbox(fixture.view.root, 'Alice').props['aria-checked']).toBe(true);
  expect(checkbox(fixture.view.root, 'Alice').props['aria-disabled']).toBe(false);
  expect(button(fixture.view.root, COPY.pingButton).props.disabled).toBe(false);
  press(checkbox(fixture.view.root, 'Alice'));
  expect(checkbox(fixture.view.root, 'Alice').props['aria-checked']).toBe(false);
  expect(button(fixture.view.root, COPY.pingButton).props.disabled).toBe(true);
});

it('uses a display-only initial when a person has no photo, keeping the name and sole checkbox', () => {
  mockPeople = [{ ...person('alice', 'Alice'), profile_photo_url: null }];
  const fixture = mount();
  const alice = fixture.view.root.findAllByType(InvitationPerson).find(item => item.props.inline)!;
  expect(alice.findAllByType(Image)).toHaveLength(0);
  expect(alice.findAll(node => node.props.children === 'A' && node.props.accessible === false).length).toBeGreaterThan(0);
  expect(alice.findAll(node => node.props.accessibilityRole === 'button')).toHaveLength(0);
  expect(alice.findAll(node => node.props.accessibilityLabel === 'No shared plans yet')).toHaveLength(0);
  press(checkbox(alice, 'Alice'));
  expect(checkbox(alice, 'Alice').props.accessibilityState.checked).toBe(true);
});

it('shares selections between the strip and See all across close and reopen', () => {
  const fixture = mount();
  press(checkbox(fixture.view.root, 'Alice'));
  press(button(fixture.view.root, COPY.pingSeeAll));
  const content = fixture.view.root.findAll(node => node.props.importantForAccessibility && node.findAll(child => child.props.children === COPY.pingHelp).length > 0)[0];
  expect(content.props['aria-hidden']).toBe(true);
  let sheet = fixture.view.root.findByType(PingSheet);
  expect(sheet.props.selectedIds).toEqual(new Set(['alice']));
  expect(checkbox(sheet, 'Alice').props.accessibilityState.checked).toBe(true);
  press(checkbox(sheet, 'Bob'));
  press(button(sheet, COPY.pingBack));
  expect(content.props['aria-hidden']).toBe(false);
  expect(checkbox(fixture.view.root, 'Bob').props.accessibilityState.checked).toBe(true);
  press(button(fixture.view.root, COPY.pingSeeAll));
  sheet = fixture.view.root.findByType(PingSheet);
  expect(sheet.props.selectedIds).toEqual(new Set(['alice', 'bob']));
  press(checkbox(sheet, 'Alice'));
  press(button(sheet, COPY.pingBack));
  expect(checkbox(fixture.view.root, 'Alice').props.accessibilityState.checked).toBe(false);
});

it('serializes rapid sends, blocks stale exit callbacks while pending, and acknowledges only after resolution', async () => {
  const pending = deferred();
  mockPing.mockReturnValue(pending.promise);
  const fixture = mount();
  press(checkbox(fixture.view.root, 'Alice'));
  const skip = button(fixture.view.root, COPY.pingSkip).props.onPress;
  press(button(fixture.view.root, COPY.pingSeeAll));
  const sheet = fixture.view.root.findByType(PingSheet);
  const close = sheet.props.onClose;
  const send = sheet.props.onSend;
  act(() => { send(); send(); close(); skip(); });
  expect(fixture.onBusyChange).toHaveBeenCalledWith(true);
  await flush();
  expect(mockPing).toHaveBeenCalledTimes(1);
  expect(mockPing).toHaveBeenCalledWith({ recipientId: 'alice', eventId: 'plan' });
  expect(fixture.view.root.findByType(PingSheet).props.visible).toBe(true);
  expect(button(fixture.view.root.findByType(PingSheet), COPY.pingBack).props.disabled).toBe(true);
  act(() => fixture.view.root.findByType(PingSheet).findAll(node => typeof node.props.onRequestClose === 'function')[0].props.onRequestClose());
  expect(fixture.view.root.findByType(PingSheet).props.visible).toBe(true);
  act(() => jest.advanceTimersByTime(PING_AUTOFADE_MS * 2));
  expect(fixture.onDone).not.toHaveBeenCalled();
  expect(hapticSuccess).not.toHaveBeenCalled();
  pending.resolve();
  await flush();
  expect(fixture.onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(hapticSuccess).toHaveBeenCalledTimes(1);
  expect(fixture.onDone).toHaveBeenCalledTimes(1);
});

it('keeps only unconfirmed recipients selected and retries them only after another explicit send', async () => {
  mockPing.mockImplementation(({ recipientId }) => recipientId === 'alice' ? Promise.resolve() : Promise.reject(new Error('response lost')));
  const fixture = mount();
  press(checkbox(fixture.view.root, 'Alice'));
  press(checkbox(fixture.view.root, 'Bob'));
  press(button(fixture.view.root, COPY.pingButton));
  await flush();
  expect(fixture.onDone).not.toHaveBeenCalled();
  expect(fixture.view.root.findByType(PingSheet).props.selectedIds).toEqual(new Set(['bob']));
  expect(checkbox(fixture.view.root, COPY.pingPersonConfirmed('Alice')).props.disabled).toBe(true);
  expect(fixture.view.root.findByType(PingSheet).props.status).toMatch(/1 invite confirmed.*Couldn’t confirm 1 invite/);
  act(() => jest.advanceTimersByTime(PING_AUTOFADE_MS * 2));
  expect(mockPing).toHaveBeenCalledTimes(2);
  mockPing.mockResolvedValue(undefined);
  press(button(fixture.view.root, COPY.pingButton));
  await flush();
  expect(mockPing.mock.calls.map(([args]) => args.recipientId)).toEqual(['alice', 'bob', 'bob']);
  expect(fixture.onDone).toHaveBeenCalledTimes(1);
});

it('keeps total failure visible without a success haptic or automatic navigation, and allows an explicit exit', async () => {
  mockPing.mockRejectedValue(new Error('offline'));
  const fixture = mount();
  press(checkbox(fixture.view.root, 'Alice'));
  press(button(fixture.view.root, COPY.pingButton));
  await flush();
  expect(fixture.view.root.findByType(PingSheet).props.selectedIds).toEqual(new Set(['alice']));
  expect(fixture.view.root.findByType(PingSheet).props.status).toMatch(/^Couldn’t confirm/);
  expect(fixture.onDone).not.toHaveBeenCalled();
  expect(hapticSuccess).not.toHaveBeenCalled();
  press(button(fixture.view.root, COPY.pingSkip));
  expect(fixture.onDone).toHaveBeenCalledTimes(1);
});

it.each([['viewer', 'other-plan'], ['other-viewer', 'plan']])('isolates late results after changing scope to %s/%s', async (userId, planId) => {
  const pending = deferred();
  mockPing.mockReturnValue(pending.promise);
  const fixture = mount();
  press(checkbox(fixture.view.root, 'Alice'));
  press(button(fixture.view.root, COPY.pingButton));
  await flush();
  fixture.update(userId, planId);
  expect(fixture.view.root.findByType(PingSheet).props.selectedIds.size).toBe(0);
  pending.resolve();
  await flush();
  expect(fixture.onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(fixture.onDone).not.toHaveBeenCalled();
  expect(hapticSuccess).not.toHaveBeenCalled();
});

it('releases the parent busy guard on unmount and does not navigate on late completion', async () => {
  const pending = deferred();
  mockPing.mockReturnValue(pending.promise);
  const fixture = mount();
  press(checkbox(fixture.view.root, 'Alice'));
  press(button(fixture.view.root, COPY.pingButton));
  await flush();
  fixture.unmount();
  pending.resolve();
  await flush();
  expect(fixture.onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(fixture.onDone).not.toHaveBeenCalled();
  expect(hapticSuccess).not.toHaveBeenCalled();
});

it('retains the untouched timeout but stops it after a selection, See all, or scrolling', () => {
  const untouched = mount();
  act(() => jest.advanceTimersByTime(PING_AUTOFADE_MS));
  expect(untouched.onDone).toHaveBeenCalledTimes(1);
  untouched.unmount();
  const picked = mount();
  press(checkbox(picked.view.root, 'Alice'));
  act(() => jest.advanceTimersByTime(PING_AUTOFADE_MS * 2));
  expect(picked.onDone).not.toHaveBeenCalled();
  picked.unmount();
  const opened = mount();
  press(button(opened.view.root, COPY.pingSeeAll));
  act(() => jest.advanceTimersByTime(PING_AUTOFADE_MS * 2));
  expect(opened.onDone).not.toHaveBeenCalled();
  opened.unmount();
  const scrolled = mount();
  act(() => scrolled.view.root.findAll(view => view.props.horizontal && typeof view.props.onScrollBeginDrag === 'function')[0].props.onScrollBeginDrag());
  act(() => jest.advanceTimersByTime(PING_AUTOFADE_MS * 2));
  expect(scrolled.onDone).not.toHaveBeenCalled();
});

it('cannot add unknown recipients and rechecks the existing people list before sending', async () => {
  const fixture = mount();
  act(() => fixture.view.root.findByType(PingSheet).props.onToggle('outsider'));
  expect(fixture.view.root.findByType(PingSheet).props.selectedIds.size).toBe(0);
  press(checkbox(fixture.view.root, 'Alice'));
  mockPeople = [person('bob', 'Bob')];
  fixture.update();
  press(button(fixture.view.root, COPY.pingButton));
  await flush();
  expect(mockPing).not.toHaveBeenCalled();
  expect(fixture.onDone).not.toHaveBeenCalled();
  expect(fixture.view.root.findByType(PingSheet).props.status).toBe(COPY.pingChoosePeople);
});

it('treats a synchronous transport exception as unconfirmed and releases pending controls', async () => {
  mockPing.mockImplementation(() => { throw new Error('transport unavailable'); });
  const fixture = mount();
  press(checkbox(fixture.view.root, 'Alice'));
  press(button(fixture.view.root, COPY.pingButton));
  await flush();
  expect(fixture.view.root.findByType(PingSheet).props.busy).toBe(false);
  expect(fixture.view.root.findByType(PingSheet).props.selectedIds).toEqual(new Set(['alice']));
  expect(fixture.onDone).not.toHaveBeenCalled();
});
