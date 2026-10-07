import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, type AppStateStatus, Linking, Modal, Text } from 'react-native';
import LocationPickerModal from '../LocationPickerModal';
import { MapView } from '../../MapView';

const mockPermission = jest.fn(), mockPermissionSnapshot = jest.fn(), mockPosition = jest.fn(), mockGeocode = jest.fn();
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 'balanced' },
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockPermission(...args),
  getForegroundPermissionsAsync: (...args: unknown[]) => mockPermissionSnapshot(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockPosition(...args),
  reverseGeocodeAsync: (...args: unknown[]) => mockGeocode(...args),
}));
jest.mock('../../MapView', () => ({ MapView: () => null, Marker: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const freshPosition = { coords: { latitude: 34.0195, longitude: -118.4912 } };
const oldPosition = { coords: { latitude: 40.7128, longitude: -74.006 } };
const freshPlace = [{ name: 'Ocean Park', street: 'Ocean Avenue', city: 'Santa Monica' }];
const oldPlace = [{ name: 'Old place', street: 'Old street', city: 'Old city' }];
let tree: ReactTestRenderer, visible: boolean;
let appStateListeners: Set<(state: AppStateStatus) => void>;
const mockClose = jest.fn(), mockConfirm = jest.fn();
const render = () => <LocationPickerModal visible={visible} onClose={mockClose} onConfirm={mockConfirm} />;
const map = () => tree.root.findByType(MapView);
const button = (label: string) => tree.root.findAll(node => typeof node.props.onPress === 'function').find(node => node.props.accessibilityLabel === label)!;
const send = () => tree.root.findAll(node => typeof node.props.onPress === 'function').find(node => /Sending location|Send current location|Retry sending current location/.test(node.props.accessibilityLabel ?? ''))!;
const retry = () => tree.root.findAll(node => typeof node.props.onPress === 'function').find(node => node.findAllByType(Text).some(text => text.props.children === 'Try again'))!;
const settings = () => tree.root.findAll(node => typeof node.props.onPress === 'function').find(node => node.findAllByType(Text).some(text => text.props.children === 'Open Settings'))!;
const text = () => JSON.stringify(tree.toJSON());
async function flush() { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); }
async function mount(show = true) { visible = show; await act(async () => { tree = create(render()); }); await flush(); }
async function update(show: boolean) { visible = show; await act(async () => tree.update(render())); await flush(); }
async function advance(ms: number) { await act(async () => jest.advanceTimersByTime(ms)); await flush(); }
async function appState(state: AppStateStatus) { act(() => appStateListeners.forEach(listener => listener(state))); await flush(); }
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  appStateListeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.add(listener);
    return { remove: () => { appStateListeners.delete(listener); } };
  });
  [mockPermission, mockPermissionSnapshot, mockPosition, mockGeocode, mockClose, mockConfirm].forEach(mock => mock.mockReset());
  mockPermission.mockResolvedValue({ status: 'granted' });
  mockPermissionSnapshot.mockResolvedValue({ status: 'granted' });
  mockPosition.mockResolvedValue(freshPosition); mockGeocode.mockResolvedValue(freshPlace); mockConfirm.mockResolvedValue(true);
});
afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

it('preserves the exact current pin, balanced accuracy and confirmation payload', async () => {
  await mount();
  expect(mockPosition).toHaveBeenCalledWith({ accuracy: 'balanced' });
  expect(map().props.region).toMatchObject(freshPosition.coords);
  expect(text()).toContain('Ocean Park, Ocean Avenue, Santa Monica');
  expect(mockConfirm).not.toHaveBeenCalled();
  await act(async () => { await send().props.onPress(); });
  expect(mockConfirm).toHaveBeenCalledWith(34.0195, -118.4912, 'Ocean Park, Ocean Avenue, Santa Monica');
  expect(mockClose).not.toHaveBeenCalled(); // The existing caller owns successful dismissal.
});

it('does not access location until opened and keeps permission denial usable', async () => {
  await mount(false); expect(mockPermission).not.toHaveBeenCalled();
  mockPermission.mockResolvedValueOnce({ status: 'denied' }); await update(true);
  expect(mockPosition).not.toHaveBeenCalled(); expect(text()).toContain('Location access is off.');
  expect(send().props.disabled).toBe(true);
});

it.each(['error', 'empty'] as const)('preserves coordinate fallback for an address %s', async failure => {
  if (failure === 'error') mockGeocode.mockRejectedValueOnce(new Error('No address'));
  else mockGeocode.mockResolvedValueOnce([]);
  await mount(); await act(async () => { await send().props.onPress(); });
  expect(mockConfirm).toHaveBeenCalledWith(34.0195, -118.4912, '34.01950, -118.49120');
});

it.each(['permission', 'position', 'address'] as const)('retires pending %s when dismissed before it can continue or replace a new preview', async stage => {
  const pending = deferred<any>();
  (stage === 'permission' ? mockPermission : stage === 'position' ? mockPosition : mockGeocode).mockReturnValueOnce(pending.promise);
  await mount(); await update(false); await update(true);
  expect(map().props.region).toMatchObject(freshPosition.coords);
  const positionsBefore = mockPosition.mock.calls.length, geocodesBefore = mockGeocode.mock.calls.length;
  await act(async () => pending.resolve(stage === 'permission' ? { status: 'granted' } : stage === 'position' ? oldPosition : oldPlace)); await flush();
  expect(mockPosition).toHaveBeenCalledTimes(positionsBefore); expect(mockGeocode).toHaveBeenCalledTimes(geocodesBefore);
  expect(map().props.region).toMatchObject(freshPosition.coords);
  expect(text()).not.toContain('Old place'); expect(text()).toContain('Ocean Park');
});

it.each(['permission', 'position', 'address'] as const)('ignores a retired %s error after a fresh preview is ready', async stage => {
  const pending = deferred<any>();
  (stage === 'permission' ? mockPermission : stage === 'position' ? mockPosition : mockGeocode).mockReturnValueOnce(pending.promise);
  await mount(); await update(false); await update(true);
  await act(async () => pending.reject(new Error('Retired request failed'))); await flush();
  expect(map().props.region).toMatchObject(freshPosition.coords);
  expect(text()).toContain('Ocean Park, Ocean Avenue, Santa Monica'); expect(send().props.disabled).toBe(false);
});

it('retires the load synchronously on close without waiting for parent props to update', async () => {
  const pending = deferred<any>(); mockPermission.mockReturnValueOnce(pending.promise);
  await mount(); const close = button('Close').props.onPress;
  act(() => { close(); close(); }); expect(mockClose).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ status: 'granted' })); await flush();
  expect(mockPosition).not.toHaveBeenCalled(); expect(mockGeocode).not.toHaveBeenCalled();
});

it('retires retained send, close and system-close callbacks on a new modal visit', async () => {
  await mount(); const oldSend = send().props.onPress, oldClose = button('Close').props.onPress;
  const oldSystemClose = tree.root.findByType(Modal).props.onRequestClose;
  await update(false); await update(true);
  act(() => { void oldSend(); oldClose(); oldSystemClose(); }); await flush();
  expect(mockConfirm).not.toHaveBeenCalled(); expect(mockClose).not.toHaveBeenCalled();
  await act(async () => { await send().props.onPress(); }); expect(mockConfirm).toHaveBeenCalledTimes(1);
});

it('keeps the pin on a failed send and retries the same payload once', async () => {
  mockConfirm.mockResolvedValueOnce(false);
  await mount(); await act(async () => { await send().props.onPress(); });
  expect(text()).toContain("Couldn't confirm delivery."); expect(map().props.region).toMatchObject(freshPosition.coords);
  await act(async () => { await send().props.onPress(); });
  expect(mockConfirm).toHaveBeenCalledTimes(2); expect(mockConfirm.mock.calls[1]).toEqual(mockConfirm.mock.calls[0]);
});

it('does not let an old send failure or finalizer affect a new visit send', async () => {
  const old = deferred<boolean>(), fresh = deferred<boolean>(); mockConfirm.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  await mount(); act(() => { void send().props.onPress(); });
  await update(false); await update(true); expect(send().props.disabled).toBe(false);
  const freshSend = send().props.onPress; act(() => { void freshSend(); }); expect(mockConfirm).toHaveBeenCalledTimes(2);
  await act(async () => old.resolve(false)); await flush();
  expect(send().props.accessibilityLabel).toBe('Sending location'); expect(text()).not.toContain("Couldn't confirm delivery.");
  act(() => { void freshSend(); }); expect(mockConfirm).toHaveBeenCalledTimes(2);
  await act(async () => fresh.resolve(false)); await flush(); expect(text()).toContain("Couldn't confirm delivery.");
});

it('serializes send and blocks queued close callbacks during the current attempt', async () => {
  const pending = deferred<boolean>(); mockConfirm.mockReturnValueOnce(pending.promise);
  await mount(); const sendPin = send().props.onPress, close = button('Close').props.onPress, systemClose = tree.root.findByType(Modal).props.onRequestClose;
  act(() => { void sendPin(); void sendPin(); close(); systemClose(); });
  expect(mockConfirm).toHaveBeenCalledTimes(1); expect(mockClose).not.toHaveBeenCalled();
  await act(async () => pending.resolve(false)); await flush();
  act(() => button('Close').props.onPress()); expect(mockClose).toHaveBeenCalledTimes(1);
});

it('starts only one retry load and retires its queued control on reopening', async () => {
  mockPosition.mockRejectedValueOnce(new Error('No GPS')); await mount();
  const retryLoad = retry().props.onPress, pending = deferred<any>(); mockPermission.mockReturnValueOnce(pending.promise);
  act(() => { void retryLoad(); void retryLoad(); }); expect(mockPermission).toHaveBeenCalledTimes(2);
  await update(false); await update(true);
  act(() => { void retryLoad(); }); await flush(); expect(mockPermission).toHaveBeenCalledTimes(3);
  await act(async () => pending.resolve({ status: 'granted' })); await flush(); expect(mockPosition).toHaveBeenCalledTimes(2);
});

it('does not launch settings from a denied preview after it was dismissed', async () => {
  const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  mockPermission.mockResolvedValueOnce({ status: 'denied' }); await mount();
  const openSettings = tree.root.findAll(node => typeof node.props.onPress === 'function').find(node => node.findAllByType(Text).some(label => label.props.children === 'Open Settings'))!.props.onPress;
  await update(false); await update(true);
  act(() => { void openSettings(); }); expect(settings).not.toHaveBeenCalled();
});

it('stops an unmounted permission request before requesting GPS', async () => {
  const pending = deferred<any>(); mockPermission.mockReturnValueOnce(pending.promise); await mount();
  await act(async () => tree.unmount()); await act(async () => pending.resolve({ status: 'granted' })); await flush();
  expect(mockPosition).not.toHaveBeenCalled(); expect(mockGeocode).not.toHaveBeenCalled();
});

it('ends a stalled GPS wait after 15 seconds and lets a fresh retry own the preview', async () => {
  const pending = deferred<any>(); mockPosition.mockReturnValueOnce(pending.promise);
  await mount(); await advance(14999);
  expect(text()).toContain('Finding your location...'); expect(send().props.disabled).toBe(true);
  await advance(1);
  expect(text()).toContain("Couldn't get your location."); expect(retry()).toBeDefined();
  act(() => { void retry().props.onPress(); }); await flush();
  expect(map().props.region).toMatchObject(freshPosition.coords);
  expect(mockGeocode).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(oldPosition)); await flush();
  expect(mockGeocode).toHaveBeenCalledTimes(1);
  expect(map().props.region).toMatchObject(freshPosition.coords);
  expect(mockConfirm).not.toHaveBeenCalled();
});

it('uses the exact coordinate fallback after five seconds of waiting for an address', async () => {
  const pending = deferred<any>(); mockGeocode.mockReturnValueOnce(pending.promise);
  await mount(); await advance(4999); expect(send().props.disabled).toBe(true);
  await advance(1);
  expect(map().props.region).toMatchObject(freshPosition.coords);
  expect(text()).toContain('34.01950, -118.49120'); expect(send().props.disabled).toBe(false);
  expect(mockConfirm).not.toHaveBeenCalled();
  await act(async () => pending.resolve(oldPlace)); await flush();
  expect(text()).not.toContain('Old place'); expect(text()).toContain('34.01950, -118.49120');
  await act(async () => { await send().props.onPress(); });
  expect(mockConfirm).toHaveBeenCalledWith(34.0195, -118.4912, '34.01950, -118.49120');
});

it('does not put a deadline on the operating-system permission prompt', async () => {
  const pending = deferred<any>(); mockPermission.mockReturnValueOnce(pending.promise);
  await mount(); await advance(60000);
  expect(text()).toContain('Finding your location...'); expect(mockPosition).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ status: 'granted' })); await flush();
  expect(map().props.region).toMatchObject(freshPosition.coords);
});

it('rechecks permission once after this visit opens Settings and returns', async () => {
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  mockPermission.mockResolvedValueOnce({ status: 'denied' }); await mount();
  await appState('inactive'); await appState('active');
  expect(mockPermissionSnapshot).not.toHaveBeenCalled(); expect(mockPermission).toHaveBeenCalledTimes(1);
  const openSettings = settings().props.onPress;
  act(() => { void openSettings(); void openSettings(); }); await flush(); expect(open).toHaveBeenCalledTimes(1);
  await appState('active'); expect(mockPermissionSnapshot).not.toHaveBeenCalled();
  await appState('inactive'); await appState('background'); await appState('active');
  expect(mockPermissionSnapshot).toHaveBeenCalledTimes(1); expect(mockPermission).toHaveBeenCalledTimes(1);
  expect(map().props.region).toMatchObject(freshPosition.coords); expect(mockConfirm).not.toHaveBeenCalled();
  await appState('background'); await appState('active');
  expect(mockPermissionSnapshot).toHaveBeenCalledTimes(1); expect(mockPosition).toHaveBeenCalledTimes(1);
});

it('keeps a denied Settings return usable without prompting again on later foregrounds', async () => {
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  mockPermission.mockResolvedValueOnce({ status: 'denied' });
  mockPermissionSnapshot.mockResolvedValueOnce({ status: 'denied' }); await mount();
  act(() => { void settings().props.onPress(); }); await flush();
  await appState('background'); await appState('active');
  expect(text()).toContain('Location access is off.'); expect(mockPosition).not.toHaveBeenCalled();
  expect(mockPermission).toHaveBeenCalledTimes(1); expect(mockPermissionSnapshot).toHaveBeenCalledTimes(1);
  await appState('inactive'); await appState('active'); expect(mockPermissionSnapshot).toHaveBeenCalledTimes(1);
  act(() => { void settings().props.onPress(); }); await flush();
  await appState('inactive'); await appState('active');
  expect(mockPermissionSnapshot).toHaveBeenCalledTimes(2); expect(map().props.region).toMatchObject(freshPosition.coords);
});

it('discards the old Settings-return intent when the modal closes and reopens', async () => {
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  mockPermission.mockResolvedValueOnce({ status: 'denied' }); await mount();
  act(() => { void settings().props.onPress(); }); await flush(); await appState('background');
  await update(false); await update(true); await appState('active');
  expect(mockPermissionSnapshot).not.toHaveBeenCalled(); expect(mockPosition).toHaveBeenCalledTimes(1);
  expect(map().props.region).toMatchObject(freshPosition.coords);
});

it('shows a retryable Settings launch failure and ignores retired failures', async () => {
  const pending = deferred<void>();
  const open = jest.spyOn(Linking, 'openSettings').mockRejectedValueOnce(new Error('Cannot open settings')).mockReturnValueOnce(pending.promise);
  mockPermission.mockResolvedValueOnce({ status: 'denied' }); await mount();
  act(() => { void settings().props.onPress(); }); await flush();
  expect(text()).toContain("Couldn't open Settings. Please try again.");
  act(() => { void settings().props.onPress(); }); await flush(); expect(open).toHaveBeenCalledTimes(2);
  await update(false); await update(true);
  await act(async () => pending.reject(new Error('Old settings error'))); await flush();
  expect(text()).not.toContain("Couldn't open Settings."); expect(map().props.region).toMatchObject(freshPosition.coords);
});

it.each(['position', 'address'] as const)('cleans the %s deadline immediately when this visit closes', async stage => {
  const schedule = jest.spyOn(global, 'setTimeout'), clear = jest.spyOn(global, 'clearTimeout');
  const pending = deferred<any>(); (stage === 'position' ? mockPosition : mockGeocode).mockReturnValueOnce(pending.promise);
  await mount();
  const index = schedule.mock.calls.findIndex(call => call[1] === (stage === 'position' ? 15000 : 5000));
  expect(index).toBeGreaterThanOrEqual(0); const deadline = schedule.mock.results[index].value;
  act(() => button('Close').props.onPress()); await flush();
  expect(clear).toHaveBeenCalledWith(deadline);
  await act(async () => pending.reject(new Error('Retired native result'))); await flush();
  expect(mockConfirm).not.toHaveBeenCalled();
});

it('cleans successful native deadlines and does not claim a failed confirmation proves non-delivery', async () => {
  const schedule = jest.spyOn(global, 'setTimeout'), clear = jest.spyOn(global, 'clearTimeout');
  await mount();
  for (const delay of [15000, 5000]) {
    const index = schedule.mock.calls.findIndex(call => call[1] === delay);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(clear).toHaveBeenCalledWith(schedule.mock.results[index].value);
  }
  mockConfirm.mockRejectedValueOnce(new Error('Receipt response missing'));
  await act(async () => { await send().props.onPress(); });
  expect(text()).toContain("Couldn't confirm delivery. Your pin is still here. Check the chat before retrying.");
  expect(text()).not.toContain('Location not sent.'); expect(map().props.region).toMatchObject(freshPosition.coords);
});

it('keeps exact pin precision when a timed-out address displays rounded coordinates', async () => {
  const exact = { latitude: 34.01954321, longitude: -118.49126543 };
  mockPosition.mockResolvedValueOnce({ coords: exact }); mockGeocode.mockReturnValueOnce(deferred<any>().promise);
  await mount(); await advance(5000);
  expect(map().props.region).toMatchObject(exact);
  await act(async () => { await send().props.onPress(); });
  expect(mockConfirm).toHaveBeenCalledWith(exact.latitude, exact.longitude, '34.01954, -118.49127');
});

it('retires a pending Settings permission snapshot before it can start GPS in a new visit', async () => {
  const pending = deferred<any>();
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  mockPermission.mockResolvedValueOnce({ status: 'denied' }); mockPermissionSnapshot.mockReturnValueOnce(pending.promise);
  await mount(); act(() => { void settings().props.onPress(); }); await flush();
  await appState('inactive'); await appState('active'); expect(mockPermissionSnapshot).toHaveBeenCalledTimes(1);
  await update(false); await update(true); expect(map().props.region).toMatchObject(freshPosition.coords);
  await act(async () => pending.resolve({ status: 'granted' })); await flush();
  expect(mockPosition).toHaveBeenCalledTimes(1); expect(mockConfirm).not.toHaveBeenCalled();
});

it('gives a failed Settings permission snapshot an explicit retry without another automatic prompt', async () => {
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  mockPermission.mockResolvedValueOnce({ status: 'denied' }); mockPermissionSnapshot.mockRejectedValueOnce(new Error('Permission state unavailable'));
  await mount(); act(() => { void settings().props.onPress(); }); await flush();
  await appState('background'); await appState('active');
  expect(text()).toContain("Couldn't get your location."); expect(mockPermission).toHaveBeenCalledTimes(1);
  act(() => { void retry().props.onPress(); }); await flush();
  expect(map().props.region).toMatchObject(freshPosition.coords); expect(mockPermission).toHaveBeenCalledTimes(2);
});

it('removes its foreground listener and native deadline on unmount', async () => {
  const schedule = jest.spyOn(global, 'setTimeout'), clear = jest.spyOn(global, 'clearTimeout');
  const pending = deferred<any>(); mockPosition.mockReturnValueOnce(pending.promise);
  await mount(); expect(appStateListeners.size).toBe(1);
  const deadline = schedule.mock.results[schedule.mock.calls.findIndex(call => call[1] === 15000)].value;
  await act(async () => tree.unmount()); await flush();
  expect(appStateListeners.size).toBe(0); expect(clear).toHaveBeenCalledWith(deadline);
  await act(async () => pending.resolve(oldPosition)); await flush(); expect(mockGeocode).not.toHaveBeenCalled();
});
