import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform, StyleSheet, Text, View } from 'react-native';
import VoicePlayer from '../VoicePlayer';
import { AfterglowFallbackFonts, AfterglowType } from '../../../constants/Typography';

let mockPlayer: ReturnType<typeof makePlayer>, mockStatus: any;
function makePlayer(id = 1) { return { id, isLoaded: true, play: jest.fn(), pause: jest.fn(), replace: jest.fn(), seekTo: jest.fn().mockResolvedValue(undefined), setPlaybackRate: jest.fn() }; }
jest.mock('expo-audio', () => ({ useAudioPlayer: () => mockPlayer, useAudioPlayerStatus: () => mockStatus }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
let tree: ReactTestRenderer, uri: string;
let staged = false;
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 320, height: 640, scale: 2, fontScale: mockFontScale }) }));
const ready = { id: 1, currentTime: 0, duration: 8, isLoaded: true, isBuffering: false, playing: false, didJustFinish: false, playbackState: 'readyToPlay', playbackRate: 1 };
function deferred() { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => {}); return { promise, resolve, reject }; }
const control = (label: string) => tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
const text = (value: string) => tree.root.findAllByType(Text).find(node => node.props.children === value);
function screen() { return <VoicePlayer uri={uri} durationSeconds={8} isOwn={false} {...(staged ? { appearance: { fonts: AfterglowFallbackFonts } } : {})} />; }
async function mount() { await act(async () => { tree = create(screen()); }); }
async function update() { await act(async () => tree.update(screen())); }
beforeEach(() => { jest.useFakeTimers(); mockPlayer = makePlayer(); mockStatus = { ...ready }; uri = 'file:///voice-one.m4a'; staged = false; mockFontScale = 1; });
afterEach(() => { act(() => tree?.unmount()); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

it('retains ordinary play/pause and the existing three playback speeds', async () => {
  await mount(); await act(async () => control('Play voice message').props.onPress()); expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  mockStatus = { ...mockStatus, playing: true }; await update();
  await act(async () => control('Pause voice message').props.onPress()); expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
  for (const speed of [1.5, 2, 1]) { await act(async () => control('Change playback speed').props.onPress()); expect(mockPlayer.setPlaybackRate).toHaveBeenLastCalledWith(speed); }
});

it('waits for replay seek before playing and serializes duplicate replay taps', async () => {
  mockStatus = { ...ready, currentTime: 8, didJustFinish: true }; const seek = deferred(); mockPlayer.seekTo.mockReturnValueOnce(seek.promise);
  await mount(); const replay = control('Play voice message').props.onPress; let work: any;
  act(() => { work = replay(); void replay(); });
  expect(mockPlayer.seekTo).toHaveBeenCalledTimes(1); expect(mockPlayer.play).not.toHaveBeenCalled();
  await act(async () => { seek.resolve(); await work; }); expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

it('retires a deferred replay when its URI changes', async () => {
  mockStatus = { ...ready, currentTime: 8, didJustFinish: true }; const seek = deferred(); mockPlayer.seekTo.mockReturnValueOnce(seek.promise);
  await mount(); let work: any; act(() => { work = control('Play voice message').props.onPress(); });
  uri = 'file:///voice-two.m4a'; mockStatus = { ...ready }; await update();
  await act(async () => { seek.resolve(); await work; }); expect(mockPlayer.play).not.toHaveBeenCalled();
});

it('shows a retry after a rejected replay seek instead of calling play', async () => {
  mockStatus = { ...ready, currentTime: 8 }; const seek = deferred(); mockPlayer.seekTo.mockReturnValueOnce(seek.promise);
  await mount(); let work: any; act(() => { work = control('Play voice message').props.onPress(); });
  await act(async () => { seek.reject(new Error('Seek failed')); await work; });
  expect(mockPlayer.play).not.toHaveBeenCalled(); expect(control('Retry voice message')).toBeDefined();
});

it('does not dispatch playback before an asset is loaded', async () => {
  mockStatus = { ...ready, isLoaded: false, duration: 0, playbackState: 'unknown' }; await mount();
  expect(control('Loading voice message').props.disabled).toBe(true);
  await act(async () => { await control('Loading voice message').props.onPress(); }); expect(mockPlayer.play).not.toHaveBeenCalled();
  mockStatus = { ...ready }; await update(); expect(control('Play voice message')).toBeDefined();
});

it('offers explicit reload when loading stalls, without claiming the asset is missing', async () => {
  mockStatus = { ...ready, isLoaded: false, duration: 0, playbackState: 'unknown' }; await mount();
  act(() => jest.advanceTimersByTime(15000));
  expect(control('Retry voice message')).toBeDefined(); expect(text('Taking longer to load.')).toBeDefined();
  await act(async () => control('Retry voice message').props.onPress()); expect(mockPlayer.replace).toHaveBeenCalledWith(uri);
  expect(mockPlayer.play).not.toHaveBeenCalled();
  mockStatus = { ...ready }; await update(); expect(control('Play voice message')).toBeDefined();
});

it('keeps the selected speed honest when the native rate setter throws', async () => {
  mockPlayer.setPlaybackRate.mockImplementationOnce(() => { throw new Error('Unavailable'); }); await mount();
  await act(async () => control('Change playback speed').props.onPress());
  expect(text('1x')).toBeDefined(); expect(control('Retry voice message')).toBeDefined();
});

it('uses staged fonts and controls without imposing the legacy 200 point minimum', async () => {
  staged = true; await mount();
  const playStyle = StyleSheet.flatten(control('Play voice message').props.style);
  expect(playStyle).toMatchObject({ minWidth: 44, minHeight: 44 });
  expect(StyleSheet.flatten(text('1x')!.props.style)).toMatchObject({ fontFamily: AfterglowFallbackFonts.semibold, fontSize: AfterglowType.caption.fontSize });
  const outer = tree.root.findAllByType(View)[0]; expect(StyleSheet.flatten(outer.props.style).minWidth).toBe(0);
});

it('clamps touch seeking and supports the same five-second steps through accessibility', async () => {
  staged = true; mockStatus = { ...ready, currentTime: 4 }; await mount();
  act(() => control('Voice message position').props.onLayout({ nativeEvent: { layout: { width: 100 } } }));
  await act(async () => { control('Voice message position').props.onPress({ nativeEvent: { locationX: 25 } }); });
  expect(mockPlayer.seekTo).toHaveBeenLastCalledWith(2);
  for (const [actionName, target] of [['increment', 8], ['decrement', 0]]) {
    await act(async () => { control('Voice message position').props.onAccessibilityAction({ nativeEvent: { actionName } }); });
    expect(mockPlayer.seekTo).toHaveBeenLastCalledWith(target);
  }
  await act(async () => { control('Voice message position').props.onPress({ nativeEvent: { locationX: 500 } }); });
  expect(mockPlayer.seekTo).toHaveBeenLastCalledWith(8);
});

it('ignores a rejected operation belonging to a replaced player even for the same URI', async () => {
  mockStatus = { ...ready, currentTime: 8 }; const seek = deferred(); mockPlayer.seekTo.mockReturnValueOnce(seek.promise);
  await mount(); const previousPlayer = mockPlayer; let work: any;
  act(() => { work = control('Play voice message').props.onPress(); });
  mockPlayer = makePlayer(); mockStatus = { ...ready }; await update();
  await act(async () => { seek.reject(new Error('Old player closed')); await work; });
  expect(previousPlayer.play).not.toHaveBeenCalled(); expect(mockPlayer.play).not.toHaveBeenCalled();
  expect(control('Retry voice message')).toBeUndefined();
  await act(async () => control('Play voice message').props.onPress()); expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

it('does not continue a replay after the message unmounts', async () => {
  mockStatus = { ...ready, currentTime: 8 }; const seek = deferred(); mockPlayer.seekTo.mockReturnValueOnce(seek.promise);
  await mount(); let work: any; act(() => { work = control('Play voice message').props.onPress(); });
  act(() => tree.unmount()); await act(async () => { seek.resolve(); await work; });
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

it('allows another explicit retry when replace itself throws', async () => {
  mockStatus = { ...ready, isLoaded: false, playbackState: 'failed' }; mockPlayer.replace.mockImplementationOnce(() => { throw new Error('Reload failed'); });
  await mount(); await act(async () => control('Retry voice message').props.onPress());
  expect(text('Couldn’t reload this recording.')).toBeDefined();
  await act(async () => control('Retry voice message').props.onPress());
  expect(mockPlayer.replace).toHaveBeenCalledTimes(2); expect(mockPlayer.play).not.toHaveBeenCalled();
  expect(control('Loading voice message').props.disabled).toBe(true);
  mockStatus = { ...ready }; await update(); expect(control('Play voice message')).toBeDefined();
});

it('reloads once and waits for fresh readiness instead of reusing stale loaded status', async () => {
  mockPlayer.play.mockImplementationOnce(() => { throw new Error('Player failed'); }); await mount();
  const earlierPlay = control('Play voice message').props.onPress;
  await act(async () => earlierPlay()); const retry = control('Retry voice message').props.onPress;
  await act(async () => { await retry(); await retry(); await earlierPlay(); });
  expect(mockPlayer.replace).toHaveBeenCalledTimes(1); expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  expect(control('Loading voice message').props.disabled).toBe(true);
  mockStatus = { ...ready }; await update();
  await act(async () => control('Play voice message').props.onPress()); expect(mockPlayer.play).toHaveBeenCalledTimes(2);
});

it('keeps legacy decorative bars while the staged view uses actual progress alone', async () => {
  mockStatus = { ...ready, currentTime: 4 }; await mount();
  const bars = () => tree.root.findAllByType(View).filter(node => StyleSheet.flatten(node.props.style)?.width === 3);
  expect(bars()).toHaveLength(28);
  staged = true; await update(); expect(bars()).toHaveLength(0);
  expect(control('Voice message position').props.accessibilityValue).toMatchObject({ now: 4, max: 8 });
  expect(text('0:04 / 0:08')).toBeDefined();
  expect(StyleSheet.flatten(control('Voice message position').props.style)).toMatchObject({ minHeight: 44 });
});

it('does not mistake the previous player’s status for a newly mounted player’s readiness', async () => {
  staged = true; await mount();
  mockPlayer = makePlayer(2); mockStatus = { ...ready, currentTime: 7, playing: true }; await update();
  expect(control('Loading voice message').props.disabled).toBe(true);
  expect(text('0:00 / 0:08')).toBeDefined();
  await act(async () => control('Loading voice message').props.onPress()); expect(mockPlayer.play).not.toHaveBeenCalled();
  mockStatus = { ...ready, id: 2 }; await update();
  await act(async () => control('Play voice message').props.onPress()); expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

it('exposes explicit progress values for RN-web rather than a slider’s default midpoint', async () => {
  await mount();
  expect(control('Voice message position').props).toMatchObject({ 'aria-valuemin': 0, 'aria-valuemax': 8, 'aria-valuenow': 0, 'aria-valuetext': '0:00 of 0:08' });
  mockStatus = { ...ready, currentTime: 3 }; await update();
  expect(control('Voice message position').props).toMatchObject({ 'aria-valuenow': 3, 'aria-valuetext': '0:03 of 0:08' });
});

it('supports keyboard arrow and boundary seeking on web without intercepting unrelated shortcuts', async () => {
  jest.replaceProperty(Platform, 'OS', 'web'); mockStatus = { ...ready, currentTime: 4 }; await mount();
  for (const [key, target] of [['ArrowLeft', 0], ['ArrowDown', 0], ['ArrowRight', 8], ['ArrowUp', 8], ['Home', 0], ['End', 8]]) {
    const preventDefault = jest.fn();
    await act(async () => { control('Voice message position').props.onKeyDown({ key, preventDefault }); });
    expect(mockPlayer.seekTo).toHaveBeenLastCalledWith(target); expect(preventDefault).toHaveBeenCalledTimes(1);
  }
  const count = mockPlayer.seekTo.mock.calls.length, preventDefault = jest.fn();
  await act(async () => {
    control('Voice message position').props.onKeyDown({ key: 'Tab', preventDefault });
    control('Voice message position').props.onKeyDown({ key: 'ArrowRight', metaKey: true, preventDefault });
  });
  expect(mockPlayer.seekTo).toHaveBeenCalledTimes(count); expect(preventDefault).not.toHaveBeenCalled();
});

it.each(['replay', 'scrub'] as const)('recovers a stalled native %s without late automatic playback', async action => {
 mockStatus = {...ready,currentTime:action==='replay'?8:4};
 const pending=deferred();mockPlayer.seekTo.mockReturnValueOnce(pending.promise);
 await mount();
 act(()=>{ if(action==='replay') void control('Play voice message').props.onPress();
   else control('Voice message position').props.onAccessibilityAction({nativeEvent:{actionName:'increment'}}); });
 expect(control('Preparing voice message').props.disabled).toBe(true);
 await act(async()=>{jest.advanceTimersByTime(15000);});
 expect(control('Retry voice message')).toBeDefined();
 expect(control('Retry voice message').props.disabled).toBe(false);
 await act(async()=>control('Retry voice message').props.onPress());
 expect(mockPlayer.replace).toHaveBeenCalledTimes(1);
 await act(async()=>pending.resolve());
 expect(mockPlayer.play).not.toHaveBeenCalled();
 expect(control('Loading voice message').props.disabled).toBe(true);
 mockStatus={...ready};await update();
 await act(async()=>control('Play voice message').props.onPress());
 expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});


it('fits decorative bars within a narrow measured rail and keeps progress and seeking accurate', async () => {
  mockStatus = { ...ready, currentTime: 4 }; await mount();
  const bars = () => tree.root.findAllByType(View).filter(node => StyleSheet.flatten(node.props.style)?.width === 3);
  // A 320-point draft gives its player 216 points after outer controls/gaps.
  // Enlarged play/metadata may leave only 88 points for the waveform.
  for (const width of [88, 63, 138]) {
    act(() => control('Voice message position').props.onLayout({ nativeEvent: { layout: { width } } }));
    const count = bars().length;
    expect(count * 3 + Math.max(0, count - 1) * 2).toBeLessThanOrEqual(width);
    expect(bars().filter(node => StyleSheet.flatten(node.props.style)?.opacity === 1)).toHaveLength(Math.round(count / 2));
    await act(async () => control('Voice message position').props.onPress({ nativeEvent: { locationX: width / 2 } }));
    expect(mockPlayer.seekTo).toHaveBeenLastCalledWith(4);
  }
});

it.each([false, true])('remeasures only native playback labels on mounted font resizing (staged=%s)', async appearance => {
  staged = appearance; mockStatus = { ...ready, currentTime: 4, playing: true }; await mount();
  await act(async () => control('Change playback speed').props.onPress());
  const caption = () => text(staged ? '0:04 / 0:08' : '0:04')!;
  const firstCaption = caption(), firstSpeed = text('1.5x');
  const playerIdentity = tree.root.findByType(VoicePlayer);
  mockFontScale = 2; await update();
  expect(caption()).not.toBe(firstCaption); expect(text('1.5x')).not.toBe(firstSpeed);
  expect(tree.root.findByType(VoicePlayer)).toBe(playerIdentity);
  expect(control('Pause voice message')).toBeDefined();
  expect(mockPlayer.pause).not.toHaveBeenCalled(); expect(mockPlayer.replace).not.toHaveBeenCalled();
  expect(mockPlayer.setPlaybackRate).toHaveBeenCalledTimes(1);
  const enlargedCaption = caption(); mockFontScale = 1; await update();
  expect(caption()).not.toBe(enlargedCaption);
  expect(text('1.5x')).toBeDefined();
});
