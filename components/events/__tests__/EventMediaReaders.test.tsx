import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Image } from 'expo-image';
const mockHook = jest.fn(), mockRelease = jest.fn(), mockRemove = jest.fn();
let mockVideoSource: unknown, mockVideoError: (event: any) => void;
jest.mock('../../../hooks/useEventMediaSource', () => ({ useEventMediaSource: (...args: unknown[]) => mockHook(...args) }));
jest.mock('expo-video', () => ({
  VideoView: 'VideoView', useVideoPlayer: (source: unknown, setup: (p: any) => void) => {
    mockVideoSource = source;
    require('react').useEffect(() => () => mockRelease(), []);
    const p = { status: 'readyToPlay', loop: true, addListener: (_name: string, callback: any) => { mockVideoError = callback; return { remove: mockRemove }; } };
    setup(p); return p;
  },
}));
import { EventMediaImage } from '../EventMediaImage';
import { EventMediaVideo } from '../EventMediaVideo';
const event = '11111111-1111-4111-8111-111111111111', path = `${event}/private-22222222-2222-4222-8222-222222222222.jpg`;
const source = { uri: 'authenticated-private', headers: { Authorization: 'test' }, useCaching: false };
let tree: ReactTestRenderer, state: any;
beforeEach(() => {
  jest.clearAllMocks(); state = { source, error: false, retry: jest.fn(), fail: jest.fn(), current: () => true, generation: 1 };
  mockHook.mockImplementation(() => state);
});
afterEach(() => act(() => tree?.unmount()));
it('preserves legacy image props and fallback without subscribing to private identity reads', () => {
  const onError = jest.fn(); act(() => { tree = create(<EventMediaImage eventId={event} reference="https://legacy/image" onError={onError} cachePolicy="memory-disk" />); });
  const image = tree.root.findByType(Image); expect(image.props.source).toEqual({ uri: 'https://legacy/image' }); expect(image.props.cachePolicy).toBe('memory-disk');
  act(() => image.props.onError()); expect(onError).toHaveBeenCalledTimes(1); expect(mockHook).not.toHaveBeenCalled();
});
it('disables cache and transition for private images and uses a retry without invoking a public fallback', () => {
  const onError = jest.fn(); act(() => { tree = create(<EventMediaImage eventId={event} reference={`creator-event-media:${path}`} cachePolicy="memory-disk" transition={500} onError={onError} />); });
  const image = tree.root.findByType(Image); expect(image.props.cachePolicy).toBe('none'); expect(image.props.transition).toBe(0); expect(image.props.source).toBe(source);
  act(() => image.props.onError()); expect(state.fail).toHaveBeenCalledTimes(1); expect(onError).not.toHaveBeenCalled();
  state = { ...state, source: undefined, error: true }; act(() => tree.update(<EventMediaImage eventId={event} reference={`creator-event-media:${path}`} />));
  expect(tree.root.findAllByType(Image)).toHaveLength(0);
  const retry = tree.root.findAll(n => n.props.accessibilityLabel === 'Photo unavailable. Retry photo' && n.props.onPress)[0];
  act(() => retry.props.onPress()); expect(state.retry).toHaveBeenCalledTimes(1);
});
it('ignores retired decoding success and passes the exact event/body reference to the reader', () => {
  const onLoad = jest.fn(); state.current = () => false;
  act(() => { tree = create(<EventMediaImage eventId={event} reference={path} kind="image" onLoad={onLoad} />); });
  expect(mockHook).toHaveBeenCalledWith(event, path, 'image'); act(() => tree.root.findByType(Image).props.onLoad({})); expect(onLoad).not.toHaveBeenCalled();
});
it('releases the private player on scope retirement and reloads a new player for retry', () => {
  const videoPath = path.replace('.jpg', '.mp4');
  act(() => { tree = create(<EventMediaVideo eventId={event} path={videoPath} style={{ height: 220 }} />); });
  expect(mockVideoSource).toBe(source); expect(mockHook).toHaveBeenCalledWith(event, videoPath, 'video');
  act(() => mockVideoError({ status: 'error' })); expect(state.fail).toHaveBeenCalledTimes(1);
  state = { ...state, source: undefined, error: true }; act(() => tree.update(<EventMediaVideo eventId={event} path={videoPath} style={{ height: 220 }} />));
  expect(mockRelease).toHaveBeenCalledTimes(1); expect(mockRemove).toHaveBeenCalled();
  const retry = tree.root.findAll(n => n.props.accessibilityLabel === 'Video unavailable. Retry video' && n.props.onPress)[0];
  act(() => retry.props.onPress()); expect(state.retry).toHaveBeenCalledTimes(1);
});
it('preserves the existing public MP4 player path', () => {
  act(() => { tree = create(<EventMediaVideo eventId={event} path={`${event}/old.mp4`} style={{ height: 220 }} />); });
  expect(mockVideoSource).toEqual(expect.stringContaining(`/object/public/event-content/${event}/old.mp4`)); expect(mockHook).not.toHaveBeenCalled();
});
