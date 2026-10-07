import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useVoiceRecorder } from '../useVoiceRecorder';

const mockPermission = jest.fn(), mockMode = jest.fn(), mockPrepare = jest.fn();
const mockRecord = jest.fn(), mockPause = jest.fn(), mockStop = jest.fn(), mockLog = jest.fn();
let mockNativeRecording = false, mockUri: string | null;
let mockState: { isRecording: boolean; durationMillis: number; metering?: number };
const mockRecorder = {
  prepareToRecordAsync: (...args: unknown[]) => mockPrepare(...args),
  record: (...args: unknown[]) => mockRecord(...args),
  pause: (...args: unknown[]) => mockPause(...args),
  stop: (...args: unknown[]) => mockStop(...args),
  get isRecording() { return mockNativeRecording; },
  get uri() { return mockUri; },
};
const mockRecorderOptions = jest.fn();
jest.mock('expo-audio', () => ({
  useAudioRecorder: (options: unknown) => { mockRecorderOptions(options); return mockRecorder; },
  useAudioRecorderState: () => mockState,
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, bitRate: 128000 } },
  requestRecordingPermissionsAsync: (...args: unknown[]) => mockPermission(...args),
  setAudioModeAsync: (...args: unknown[]) => mockMode(...args),
}));
jest.mock('../../lib/logger', () => ({ logError: (...args: unknown[]) => mockLog(...args) }));

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Scope = { isCurrent: () => boolean };
const scopedHook = useVoiceRecorder as (scope?: Scope) => ReturnType<typeof useVoiceRecorder>;
let tree: ReactTestRenderer, current: ReturnType<typeof useVoiceRecorder>, epoch: number, scope: Scope | undefined;
function nextScope() { const captured = ++epoch; return { isCurrent: () => epoch === captured }; }
function Harness() { current = scopedHook(scope); return null; }
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
async function mount() { await act(async () => { tree = create(<Harness />); }); }
async function update() { await act(async () => tree.update(<Harness />)); await flush(); }
async function start() { let result = false; await act(async () => { result = await current.start(); }); return result; }
beforeEach(() => {
  [mockPermission, mockMode, mockPrepare, mockRecord, mockPause, mockStop, mockLog, mockRecorderOptions].forEach(mock => mock.mockReset());
  epoch = 0; scope = nextScope(); mockNativeRecording = false; mockUri = 'file:///voice.m4a';
  mockState = { isRecording: false, durationMillis: 0 };
  mockPermission.mockResolvedValue({ granted: true }); mockMode.mockResolvedValue(undefined); mockPrepare.mockResolvedValue(undefined);
  mockRecord.mockImplementation(() => { mockNativeRecording = true; });
  mockPause.mockImplementation(() => { mockNativeRecording = false; });
  mockStop.mockImplementation(async () => { mockNativeRecording = false; });
});
afterEach(async () => { await act(async () => tree?.unmount()); await flush(); jest.restoreAllMocks(); });

it('keeps the existing format, pause/resume and stopped payload including metering/duration', async () => {
  scope = undefined; await mount(); expect(await start()).toBe(true); expect(current.status).toBe('recording');
  expect(mockRecorderOptions).toHaveBeenCalledWith({ extension: '.m4a', sampleRate: 44100, bitRate: 128000, isMeteringEnabled: true });
  mockState = { isRecording: true, durationMillis: 2450, metering: -30 }; await update();
  act(() => current.pause()); expect(current.status).toBe('paused'); act(() => current.resume()); expect(current.status).toBe('recording');
  let result; await act(async () => { result = await current.stop(); });
  expect(result).toEqual({ uri: 'file:///voice.m4a', durationSeconds: 2, meterings: [0.5] });
  expect(current.status).toBe('idle'); expect(mockMode).toHaveBeenLastCalledWith({ allowsRecording: false });
});

it('keeps permission denial idle without opening recording mode', async () => {
  mockPermission.mockResolvedValueOnce({ granted: false }); await mount(); expect(await start()).toBe(false);
  expect(mockMode).not.toHaveBeenCalled(); expect(mockPrepare).not.toHaveBeenCalled(); expect(mockRecord).not.toHaveBeenCalled();
  expect(current.status).toBe('idle');
});

it('begins only one start from duplicated callbacks before React rerenders', async () => {
  const pending = deferred<{ granted: boolean }>(); mockPermission.mockReturnValueOnce(pending.promise);
  await mount(); const begin = current.start; let first!: Promise<boolean>, second!: Promise<boolean>;
  act(() => { first = begin(); second = begin(); }); expect(mockPermission).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ granted: true }); await first; await second; }); expect(mockRecord).toHaveBeenCalledTimes(1);
});

it.each(['permission', 'mode', 'prepare'] as const)('does not start recording after a pending %s loses its scope', async stage => {
  const pending = deferred<any>(); (stage === 'permission' ? mockPermission : stage === 'mode' ? mockMode : mockPrepare).mockReturnValueOnce(pending.promise);
  await mount(); let work!: Promise<boolean>; act(() => { work = current.start(); }); await flush();
  scope = nextScope(); await update();
  await act(async () => { pending.resolve(stage === 'permission' ? { granted: true } : undefined); expect(await work).toBe(false); }); await flush();
  expect(mockRecord).not.toHaveBeenCalled(); expect(current.status).toBe('idle');
  if (stage === 'permission') { expect(mockMode).not.toHaveBeenCalled(); expect(mockPrepare).not.toHaveBeenCalled(); }
  if (stage === 'mode') expect(mockPrepare).not.toHaveBeenCalled();
});

it('retires a pending permission immediately on cancel', async () => {
  const permission = deferred<{ granted: boolean }>(); mockPermission.mockReturnValueOnce(permission.promise);
  await mount(); let work!: Promise<boolean>; act(() => { work = current.start(); }); await flush();
  await act(async () => { await current.cancel(); });
  await act(async () => { permission.resolve({ granted: true }); expect(await work).toBe(false); });
  expect(mockPrepare).not.toHaveBeenCalled(); expect(mockRecord).not.toHaveBeenCalled();
});

it('finishes old preparation cleanup before preparing a new scope recording', async () => {
  const prepare = deferred(); mockPrepare.mockReturnValueOnce(prepare.promise);
  await mount(); let old!: Promise<boolean>, fresh!: Promise<boolean>; act(() => { old = current.start(); }); await flush();
  scope = nextScope(); await update(); act(() => { fresh = current.start(); }); await flush();
  expect(mockPrepare).toHaveBeenCalledTimes(1); expect(mockRecord).not.toHaveBeenCalled();
  await act(async () => { prepare.resolve(); expect(await old).toBe(false); expect(await fresh).toBe(true); });
  expect(mockRecord).toHaveBeenCalledTimes(1); expect(mockNativeRecording).toBe(true); expect(current.status).toBe('recording');
  expect(mockStop.mock.invocationCallOrder[0]).toBeLessThan(mockPrepare.mock.invocationCallOrder[1]);
  expect(mockMode).toHaveBeenLastCalledWith({ allowsRecording: true, playsInSilentMode: true });
});

it('waits for cancel cleanup before a subsequent recording can prepare', async () => {
  await mount(); await start(); const stop = deferred(); mockStop.mockReturnValueOnce(stop.promise);
  let cancel!: Promise<void>, fresh!: Promise<boolean>; act(() => { cancel = current.cancel(); }); await flush();
  act(() => { fresh = current.start(); }); await flush(); expect(mockPrepare).toHaveBeenCalledTimes(1);
  await act(async () => { stop.resolve(); await cancel; expect(await fresh).toBe(true); });
  expect(mockPrepare).toHaveBeenCalledTimes(2); expect(mockRecord).toHaveBeenCalledTimes(2); expect(current.status).toBe('recording');
  expect(mockMode).toHaveBeenLastCalledWith({ allowsRecording: true, playsInSilentMode: true });
});

it('returns one stopped clip from duplicated stop callbacks', async () => {
  await mount(); await start(); const stop = deferred(); mockStop.mockReturnValueOnce(stop.promise);
  const finish = current.stop; let first!: ReturnType<typeof finish>, second!: ReturnType<typeof finish>;
  act(() => { first = finish(); second = finish(); }); await flush(); expect(mockStop).toHaveBeenCalledTimes(1);
  await act(async () => { stop.resolve(); expect(await first).toMatchObject({ uri: 'file:///voice.m4a', durationSeconds: 1 }); expect(await second).toBeNull(); });
});

it('discards the pending stop payload when cancellation supersedes it', async () => {
  await mount(); await start(); const stopped = deferred(); mockStop.mockReturnValueOnce(stopped.promise);
  let finish!: ReturnType<typeof current.stop>, cancel!: Promise<void>;
  act(() => { finish = current.stop(); }); await flush(); act(() => { cancel = current.cancel(); });
  await act(async () => { stopped.resolve(); expect(await finish).toBeNull(); await cancel; });
  expect(mockStop).toHaveBeenCalledTimes(1); expect(current.status).toBe('idle');
});

it('does not return an old clip or reset new recording state after a scope transition', async () => {
  await mount(); await start(); const stopped = deferred(); mockStop.mockReturnValueOnce(stopped.promise);
  let old!: ReturnType<typeof current.stop>, fresh!: Promise<boolean>;
  act(() => { old = current.stop(); }); await flush(); scope = nextScope(); await update();
  act(() => { fresh = current.start(); }); await flush(); expect(mockPrepare).toHaveBeenCalledTimes(1);
  await act(async () => { stopped.resolve(); expect(await old).toBeNull(); expect(await fresh).toBe(true); });
  expect(current.status).toBe('recording'); expect(mockNativeRecording).toBe(true);
});

it('ignores retained pause/resume/cancel/stop/start callbacks from a retired scope', async () => {
  await mount(); await start(); const retired = current;
  scope = nextScope(); await update(); await start();
  const counts = [mockPause.mock.calls.length, mockRecord.mock.calls.length, mockStop.mock.calls.length, mockPermission.mock.calls.length];
  await act(async () => { retired.pause(); retired.resume(); await retired.cancel(); expect(await retired.stop()).toBeNull(); expect(await retired.start()).toBe(false); });
  expect([mockPause.mock.calls.length, mockRecord.mock.calls.length, mockStop.mock.calls.length, mockPermission.mock.calls.length]).toEqual(counts);
  expect(current.status).toBe('recording');
});

it('respects a scope revoked before React commits a replacement', async () => {
  await mount(); const begin = current.start; epoch++;
  await act(async () => expect(await begin()).toBe(false)); expect(mockPermission).not.toHaveBeenCalled();
});

it('never records after an unmounted preparation finishes', async () => {
  const prepared = deferred(); mockPrepare.mockReturnValueOnce(prepared.promise);
  await mount(); let work!: Promise<boolean>; act(() => { work = current.start(); }); await flush();
  await act(async () => tree.unmount());
  await act(async () => { prepared.resolve(); expect(await work).toBe(false); }); await flush(); expect(mockRecord).not.toHaveBeenCalled();
});

it('recovers after a current preparation failure', async () => {
  mockPrepare.mockRejectedValueOnce(new Error('Microphone busy')); await mount(); expect(await start()).toBe(false);
  expect(current.status).toBe('idle'); expect(mockLog).toHaveBeenCalledTimes(1); expect(await start()).toBe(true);
});

it('treats stop during permission as discarding the pending start', async () => {
  const permission = deferred<{ granted: boolean }>(); mockPermission.mockReturnValueOnce(permission.promise);
  await mount(); let work!: Promise<boolean>; act(() => { work = current.start(); });
  await act(async () => expect(await current.stop()).toBeNull());
  await act(async () => { permission.resolve({ granted: true }); expect(await work).toBe(false); });
  expect(mockPrepare).not.toHaveBeenCalled(); expect(mockRecord).not.toHaveBeenCalled();
});

it('waits for recording-mode release before a new scope acquires recording mode', async () => {
  await mount(); await start(); const release = deferred();
  mockMode.mockImplementationOnce(() => release.promise).mockResolvedValue(undefined);
  let old!: ReturnType<typeof current.stop>, fresh!: Promise<boolean>;
  act(() => { old = current.stop(); }); await flush();
  expect(mockMode).toHaveBeenLastCalledWith({ allowsRecording: false });
  scope = nextScope(); await update(); act(() => { fresh = current.start(); }); await flush();
  expect(mockPrepare).toHaveBeenCalledTimes(1);
  await act(async () => { release.resolve(); expect(await old).toBeNull(); expect(await fresh).toBe(true); });
  expect(mockMode).toHaveBeenLastCalledWith({ allowsRecording: true, playsInSilentMode: true });
  expect(current.status).toBe('recording');
});

it('ignores a stale preparation failure and still starts the queued current attempt', async () => {
  const prepare = deferred(); mockPrepare.mockReturnValueOnce(prepare.promise);
  await mount(); let old!: Promise<boolean>, fresh!: Promise<boolean>; act(() => { old = current.start(); }); await flush();
  scope = nextScope(); await update(); act(() => { fresh = current.start(); }); await flush();
  await act(async () => { prepare.reject(new Error('Retired preparation')); expect(await old).toBe(false); expect(await fresh).toBe(true); });
  expect(mockLog).not.toHaveBeenCalled(); expect(current.status).toBe('recording');
});

it('keeps pause/resume synchronous and ignores duplicate controls for the same phase', async () => {
  await mount(); await start(); const pause = current.pause, resume = current.resume;
  act(() => { pause(); pause(); }); expect(mockPause).toHaveBeenCalledTimes(1);
  act(() => { resume(); resume(); }); expect(mockRecord).toHaveBeenCalledTimes(2);
});

it('cleans up a paused recorder on unmount even though its native isRecording flag is false', async () => {
  await mount(); await start(); act(() => current.pause()); expect(mockNativeRecording).toBe(false);
  await act(async () => tree.unmount()); await flush();
  expect(mockStop).toHaveBeenCalledTimes(1); expect(mockMode).toHaveBeenLastCalledWith({ allowsRecording: false });
});

it('bounds and normalizes the recorded waveform while preserving its captured envelope', async () => {
  let now = 1000; jest.spyOn(Date, 'now').mockImplementation(() => now);
  await mount(); await start();
  for (let i = 0; i < 52; i++) {
    now += 100; mockState = { isRecording: true, durationMillis: (i + 1) * 100, metering: -60 + i }; await update();
  }
  expect(current.meterings).toHaveLength(48); expect(current.meterings[0]).toBeCloseTo(4 / 60);
  let result: Awaited<ReturnType<typeof current.stop>> = null;
  await act(async () => { result = await current.stop(); });
  expect(result).toMatchObject({ uri: 'file:///voice.m4a', durationSeconds: 5 });
  expect(result!.meterings).toHaveLength(48); expect(result!.meterings[47]).toBeCloseTo(51 / 60);
  expect(current.meterings).toEqual([]); expect(current.durationMillis).toBe(0);
});

it('handles an already-released native recorder during cleanup without rejecting', async () => {
  await mount(); await start(); mockStop.mockRejectedValueOnce(new Error('Native object released'));
  await act(async () => current.cancel());
  expect(current.status).toBe('idle'); expect(mockMode).toHaveBeenLastCalledWith({ allowsRecording: false });
});
