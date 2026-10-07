import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Linking } from 'react-native';
import { usePlansNearMe } from '../usePlansNearMe';
import { requestNearMeLocation } from '../../lib/location/nearMe';

let mockFocused = true;
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => any) => require('react').useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]) }));
jest.mock('../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('../../lib/location/nearMe', () => ({ requestNearMeLocation: jest.fn() }));
const location = jest.mocked(requestNearMeLocation);
const coords = { lat: 34.005, lng: -118.487 };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
let hook: ReturnType<typeof usePlansNearMe>, tree: ReactTestRenderer, settings: jest.SpyInstance;
function Probe() { hook = usePlansNearMe(); return null; }
function mount() { act(() => { tree = create(<Probe />); }); }
function focus(value: boolean) { mockFocused = value; act(() => tree.update(<Probe />)); }
beforeEach(() => { jest.clearAllMocks(); mockFocused = true; location.mockReset(); location.mockResolvedValue({ ok: true, coords }); settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(); });
afterEach(() => { act(() => tree?.unmount()); jest.restoreAllMocks(); });

it('stays off without requesting location until explicitly tapped, then reuses a cached fix', async () => {
  mount(); expect(hook.active).toBe(false); expect(hook.coords).toBeNull(); expect(location).not.toHaveBeenCalled();
  await act(async () => { await hook.toggle(); }); expect(hook.active).toBe(true); expect(hook.coords).toEqual(coords);
  await act(async () => { await hook.toggle(); }); expect(hook.active).toBe(false); expect(hook.coords).toEqual(coords);
  await act(async () => { await hook.toggle(); }); expect(hook.active).toBe(true); expect(location).toHaveBeenCalledTimes(1);
});
it('keeps denied permission distinct and opens Settings without another location request', async () => {
  location.mockResolvedValue({ ok: false, reason: 'denied' }); mount();
  await act(async () => { await hook.toggle(); }); expect(hook.notice?.reason).toBe('denied'); expect(hook.active).toBe(false);
  await act(async () => { await hook.recover(); }); expect(settings).toHaveBeenCalledTimes(1); expect(location).toHaveBeenCalledTimes(1);
});
it('retries unavailable location instead of opening Settings and activates the returned fix', async () => {
  location.mockResolvedValueOnce({ ok: false, reason: 'unavailable' }); mount();
  await act(async () => { await hook.toggle(); }); expect(hook.notice?.reason).toBe('unavailable');
  await act(async () => { await hook.recover(); }); expect(location).toHaveBeenCalledTimes(2); expect(settings).not.toHaveBeenCalled();
  expect(hook.active).toBe(true); expect(hook.notice).toBeNull();
});
it('locks synchronous duplicate requests and exposes pending status until the current result', async () => {
  const pending = deferred<any>(); location.mockReturnValueOnce(pending.promise); mount(); let first!: Promise<void>;
  act(() => { first = hook.toggle(); void hook.toggle(); void hook.recover(); });
  expect(location).toHaveBeenCalledTimes(1); expect(hook.pending).toBe(true); expect(hook.pendingLabel).toBe('Finding your location…');
  await act(async () => { pending.resolve({ ok: true, coords }); await first; }); expect(hook.pending).toBe(false);
});
it.each(['success', 'unavailable', 'rejected'] as const)('ignores a late %s after leaving and returning to the feed', async result => {
  const pending = deferred<any>(); location.mockReturnValueOnce(pending.promise); mount(); let first!: Promise<void>;
  act(() => { first = hook.toggle(); }); focus(false); expect(hook.pending).toBe(false); focus(true);
  await act(async () => { if (result === 'rejected') pending.reject(new Error('old failure')); else pending.resolve(result === 'success' ? { ok: true, coords } : { ok: false, reason: 'unavailable' }); await first; });
  expect(hook.active).toBe(false); expect(hook.coords).toBeNull(); expect(hook.notice).toBeNull();
});
it('does not let an old result or cleanup disturb a new focused request', async () => {
  const old = deferred<any>(), current = deferred<any>(); location.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise); mount();
  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = hook.toggle(); }); focus(false); focus(true); act(() => { second = hook.toggle(); });
  await act(async () => { old.resolve({ ok: true, coords }); await first; }); expect(hook.pending).toBe(true); expect(hook.active).toBe(false);
  await act(async () => { current.resolve({ ok: true, coords: { lat: 34.1, lng: -118.1 } }); await second; });
  expect(hook.coords).toEqual({ lat: 34.1, lng: -118.1 }); expect(hook.pending).toBe(false);
});
it('old toggle and clear callbacks cannot change the cached filter after refocus', async () => {
  mount(); await act(async () => { await hook.toggle(); });
  const oldToggle = hook.toggle, oldClear = hook.clear;
  focus(false); focus(true);
  await act(async () => { await oldToggle(); oldClear(); });
  expect(hook.active).toBe(true); expect(hook.coords).toEqual(coords);
  await act(async () => { await hook.toggle(); }); expect(hook.active).toBe(false);
  await act(async () => { await hook.toggle(); }); expect(hook.active).toBe(true);
  act(() => oldClear()); expect(hook.active).toBe(true);
  act(() => hook.clear()); expect(hook.active).toBe(false); expect(location).toHaveBeenCalledTimes(1);
});
it('old recovery cannot open Settings after refocus but the new notice action can', async () => {
  location.mockResolvedValue({ ok: false, reason: 'denied' }); mount(); await act(async () => { await hook.toggle(); });
  const oldRecovery = hook.recover; focus(false); focus(true);
  await act(async () => { await oldRecovery(); }); expect(settings).not.toHaveBeenCalled();
  await act(async () => { await hook.recover(); }); expect(settings).toHaveBeenCalledTimes(1);
});
it('does not dispatch hidden callbacks or accept a late result after unmount', async () => {
  mount(); focus(false); await act(async () => { await hook.toggle(); await hook.recover(); }); expect(location).not.toHaveBeenCalled();
  focus(true); const pending = deferred<any>(); location.mockReturnValueOnce(pending.promise); let result!: Promise<void>;
  act(() => { result = hook.toggle(); }); act(() => tree.unmount());
  await act(async () => { pending.resolve({ ok: true, coords }); await result; }); expect(settings).not.toHaveBeenCalled();
});
it('clears filters without discarding cached location and retires an unfinished request', async () => {
  const pending = deferred<any>(); location.mockReturnValueOnce(pending.promise); mount(); let first!: Promise<void>;
  act(() => { first = hook.toggle(); hook.clear(); }); expect(hook.pending).toBe(false);
  await act(async () => { pending.resolve({ ok: true, coords }); await first; }); expect(hook.active).toBe(false); expect(hook.coords).toBeNull();
  await act(async () => { await hook.toggle(); }); act(() => hook.clear()); expect(hook.active).toBe(false); expect(hook.coords).toEqual(coords);
});
it('normalizes a rejected location call to a retryable unavailable notice', async () => {
  location.mockRejectedValueOnce(new Error('device unavailable')); mount();
  await act(async () => { await hook.toggle(); }); expect(hook.notice?.reason).toBe('unavailable'); expect(hook.pending).toBe(false);
  await act(async () => { await hook.recover(); }); expect(hook.active).toBe(true);
});
it('locks Settings recovery, presents a useful failure and ignores a stale completion', async () => {
  location.mockResolvedValue({ ok: false, reason: 'denied' }); mount(); await act(async () => { await hook.toggle(); });
  const pending = deferred<void>(); settings.mockReturnValueOnce(pending.promise); let result!: Promise<void>;
  act(() => { result = hook.recover(); void hook.recover(); }); expect(settings).toHaveBeenCalledTimes(1);
  expect(hook.pendingLabel).toBe('Opening Settings…');
  await act(async () => { pending.reject(new Error('cannot open')); await result; });
  expect(hook.notice?.message).toContain("Couldn't open Settings"); expect(hook.pending).toBe(false);
  const late = deferred<void>(); settings.mockReturnValueOnce(late.promise); act(() => { result = hook.recover(); }); focus(false); focus(true);
  await act(async () => { late.reject(new Error('old failure')); await result; }); expect(hook.pending).toBe(false);
});
