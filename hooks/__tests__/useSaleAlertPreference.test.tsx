import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
jest.mock('../../lib/eventSaleAlerts', () => ({ ...jest.requireActual('../../lib/eventSaleAlerts'), loadSaleAlertPreference: jest.fn(), saveSaleAlertPreference: jest.fn() }));
jest.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn() }, rpc: jest.fn() } }));
import { loadSaleAlertPreference, saveSaleAlertPreference, SaleAlertAccessDenied, type SaleAlertPreference } from '../../lib/eventSaleAlerts';
import { useSaleAlertPreference } from '../useSaleAlertPreference';

const eventId = '8ecc2940-0000-4000-8000-000000000001';
const userId = '8ecc2940-0000-4000-8000-000000000002';
const remote: SaleAlertPreference = { eventId, userId, enabled: false, revision: null, updatedAt: null, deliveryReady: false };
let scope = { userId, isCurrent: () => true };
let result: ReturnType<typeof useSaleAlertPreference>, tree: ReactTestRenderer;
function Screen() { result = useSaleAlertPreference(eventId, scope); return null; }
async function mount() { await act(async () => { tree = create(<Screen />); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function tick(ms: number) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => {
  jest.resetAllMocks(); scope = { userId, isCurrent: () => true };
  (loadSaleAlertPreference as jest.Mock).mockResolvedValue(remote);
  (saveSaleAlertPreference as jest.Mock).mockResolvedValue({ ...remote, enabled: true });
});
afterEach(() => { if (tree) act(() => tree.unmount()); jest.useRealTimers(); });

it('releases a stalled first read and ignores its late result after retry', async () => {
  jest.useFakeTimers(); const pending = deferred<SaleAlertPreference>();
  (loadSaleAlertPreference as jest.Mock).mockReturnValueOnce(pending.promise);
  await mount(); expect(result.busy).toBe(true);
  await tick(12000); expect(result.busy).toBe(false); expect(result.error).toBeTruthy();
  expect((loadSaleAlertPreference as jest.Mock).mock.calls[0][1].isCurrent()).toBe(false);
  await act(async () => { await result.check(); }); expect(result.remote?.enabled).toBe(false); expect(result.error).toBe('');
  await act(async () => pending.resolve({ ...remote, enabled: true })); expect(result.remote?.enabled).toBe(false);
});

it('requires a status check after an unconfirmed save and never repeats it automatically', async () => {
  jest.useFakeTimers(); await mount(); const pending = deferred<SaleAlertPreference>();
  (saveSaleAlertPreference as jest.Mock).mockReturnValueOnce(pending.promise);
  act(() => { void result.change(); void result.change(); });
  await tick(25000); expect(result.busy).toBe(false); expect(result.error).toContain('could not be confirmed');
  expect(result.remote?.enabled).toBe(false);
  await act(async () => { await result.change(); }); expect(saveSaleAlertPreference).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ ...remote, enabled: true })); expect(result.remote?.enabled).toBe(false); expect(result.error).toBeTruthy();
  (loadSaleAlertPreference as jest.Mock).mockResolvedValue({ ...remote, enabled: true });
  await act(async () => { await result.check(); }); expect(result.remote?.enabled).toBe(true); expect(result.error).toBe('');
  expect(saveSaleAlertPreference).toHaveBeenCalledTimes(1);
});

it('does not dispatch a save when its session arrives after the deadline', async () => {
  jest.useFakeTimers(); await mount(); const session = deferred<unknown>();
  const supabase = require('../../lib/supabase').supabase;
  supabase.auth.getSession.mockReturnValueOnce(session.promise);
  (saveSaleAlertPreference as jest.Mock).mockImplementationOnce(jest.requireActual('../../lib/eventSaleAlerts').saveSaleAlertPreference);
  act(() => { void result.change(); }); await tick(25000);
  await act(async () => session.resolve({ data: { session: { user: { id: userId }, access_token: 'synthetic' } }, error: null }));
  expect(supabase.rpc).not.toHaveBeenCalled(); expect(result.error).toBeTruthy(); expect(result.busy).toBe(false);
});

it('keeps the last confirmed setting after failed recovery and allows another read', async () => {
  await mount(); (saveSaleAlertPreference as jest.Mock).mockRejectedValueOnce(Error('offline'));
  await act(async () => { await result.change(); });
  (loadSaleAlertPreference as jest.Mock).mockRejectedValueOnce(Error('offline'));
  await act(async () => { await result.check(); }); expect(result.remote).toEqual(remote); expect(result.error).toBeTruthy();
  await act(async () => { await result.change(); }); expect(saveSaleAlertPreference).toHaveBeenCalledTimes(1);
  await act(async () => { await result.check(); }); expect(result.error).toBe('');
});

it('coalesces duplicate status checks and does not save during a read', async () => {
  const pending = deferred<SaleAlertPreference>(); (loadSaleAlertPreference as jest.Mock).mockReturnValueOnce(pending.promise);
  await mount(); act(() => { void result.check(); void result.change(); });
  expect(loadSaleAlertPreference).toHaveBeenCalledTimes(1); expect(saveSaleAlertPreference).not.toHaveBeenCalled();
  await act(async () => pending.resolve(remote)); expect(result.busy).toBe(false);
});

it('retires pending work on account changes and rejects old callbacks', async () => {
  await mount(); const pending = deferred<SaleAlertPreference>(); (saveSaleAlertPreference as jest.Mock).mockReturnValueOnce(pending.promise);
  const oldChange = result.change, oldCheck = result.check;
  act(() => { void oldChange(); }); scope = { userId: 'other', isCurrent: () => true };
  (loadSaleAlertPreference as jest.Mock).mockResolvedValue({ ...remote, userId: 'other' });
  await act(async () => tree.update(<Screen />));
  expect((saveSaleAlertPreference as jest.Mock).mock.calls[0][2].isCurrent()).toBe(false);
  await act(async () => { await oldChange(); await oldCheck(); pending.resolve({ ...remote, enabled: true }); });
  expect(result.remote?.userId).toBe('other'); expect(result.remote?.enabled).toBe(false); expect(saveSaleAlertPreference).toHaveBeenCalledTimes(1);
});

it('retires a pending save on unmount', async () => {
  await mount(); const pending = deferred<SaleAlertPreference>(); (saveSaleAlertPreference as jest.Mock).mockReturnValueOnce(pending.promise);
  act(() => { void result.change(); }); act(() => tree.unmount());
  expect((saveSaleAlertPreference as jest.Mock).mock.calls[0][2].isCurrent()).toBe(false);
  await act(async () => pending.resolve({ ...remote, enabled: true }));
});

it('clears the setting when access is revoked', async () => {
  await mount(); (saveSaleAlertPreference as jest.Mock).mockRejectedValueOnce(new SaleAlertAccessDenied());
  await act(async () => { await result.change(); }); expect(result.unavailable).toBe(true); expect(result.remote).toBeNull(); expect(result.busy).toBe(false);
});
