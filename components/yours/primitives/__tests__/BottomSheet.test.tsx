import React from 'react';
import { Animated, Modal, PanResponder, StyleSheet, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import BottomSheet, { type BottomSheetProps } from '../BottomSheet';
import { AfterglowFallbackFonts } from '../../../../constants/Typography';
import { AfterglowColors } from '../../../../constants/Colors';
let mockReduced = false;
let mockWindow = { width: 375, height: 800, scale: 1, fontScale: 1 };
jest.mock('../../a11y/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 16, left: 0, right: 0 }) }));
type Motion = { start: jest.Mock; stop: jest.Mock; callback?: (r: { finished: boolean }) => void };
const animations: Motion[] = [], cleanup: Array<() => void> = [];
const pans: any[] = [];
function animation() { const a: Motion = { start: jest.fn((cb) => { a.callback = cb; }), stop: jest.fn() }; animations.push(a); return a as unknown as Animated.CompositeAnimation; }
function mount(extra: Partial<BottomSheetProps> = {}) {
  let props = { visible: true, onClose: jest.fn(), heightPct: 0.8, children: <Text>Scrollable child</Text>, ...extra };
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<BottomSheet {...props} />); });
  let closed = false; const unmount = () => { if (!closed) act(() => tree.unmount()); closed = true; }; cleanup.push(unmount);
  return { tree, props, unmount, update: (next: Partial<BottomSheetProps> = {}) => { props = { ...props, ...next }; act(() => tree.update(<BottomSheet {...props} />)); },
    modal: () => tree.root.findByType(Modal),
    button: (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0],
    sheetStyle: () => StyleSheet.flatten(tree.root.findAll(n => n.props.accessibilityViewIsModal === true)[0].props.style),
    pan: () => pans[0],
  };
}
beforeEach(() => {
  mockReduced = false; mockWindow = { width: 375, height: 800, scale: 1, fontScale: 1 }; animations.length = 0; pans.length = 0;
  jest.spyOn(Animated, 'parallel').mockImplementation(animation);
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }));
  jest.spyOn(Animated, 'spring').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }));
  jest.spyOn(PanResponder, 'create').mockImplementation((config) => {
    pans.push(config); return { panHandlers: { onMoveShouldSetResponder: config.onMoveShouldSetPanResponder, onResponderRelease: config.onPanResponderRelease } } as any;
  });
});
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.restoreAllMocks(); });
it('does not start animation or render a modal while hidden', () => {
  const f = mount({ visible: false }); expect(animations).toHaveLength(0); expect(f.tree.root.findAllByType(Modal)).toHaveLength(0);
});
it('uses current dimensions for fixed height and safe maximum after rotation', () => {
  const f = mount(); expect(f.sheetStyle()).toMatchObject({ height: 640, maxHeight: 768 });
  mockWindow = { ...mockWindow, height: 500 }; f.update(); expect(f.sheetStyle()).toMatchObject({ height: 400, maxHeight: 468 });
});
it('locks repeated dismiss actions and waits for a finished dismissal', () => {
  const f = mount(); act(() => { f.modal().props.onRequestClose(); f.modal().props.onRequestClose(); });
  expect(animations).toHaveLength(2); expect(f.props.onClose).not.toHaveBeenCalled();
  act(() => { animations[1].callback!({ finished: true }); animations[1].callback!({ finished: true }); }); expect(f.props.onClose).toHaveBeenCalledTimes(1);
});
it('interrupted dismissal does not close and allows a new dismissal', () => {
  const f = mount(); act(() => f.modal().props.onRequestClose()); act(() => animations[1].callback!({ finished: false })); expect(f.props.onClose).not.toHaveBeenCalled();
  act(() => f.modal().props.onRequestClose()); expect(animations).toHaveLength(3); act(() => animations[2].callback!({ finished: true })); expect(f.props.onClose).toHaveBeenCalledTimes(1);
});
it('old animation callbacks cannot close a reopened visit', () => {
  const f = mount(); act(() => f.modal().props.onRequestClose()); const old = animations[1];
  f.update({ visible: false }); f.update({ visible: true }); act(() => old.callback!({ finished: true })); expect(f.props.onClose).not.toHaveBeenCalled(); expect(old.stop).toHaveBeenCalled();
});
it('old dismissal callbacks cannot close after unmount', () => {
  const f = mount(); act(() => f.modal().props.onRequestClose()); const old = animations[1]; f.unmount(); act(() => old.callback!({ finished: true })); expect(f.props.onClose).not.toHaveBeenCalled();
});
it('drag dismissal uses the current close callback instead of the first-render closure', () => {
  const f = mount(), latest = jest.fn(); f.update({ onClose: latest });
  act(() => f.pan().onPanResponderRelease({}, { dy: 100, vy: 0 })); act(() => animations[1].callback!({ finished: true }));
  expect(latest).toHaveBeenCalledTimes(1); expect(f.props.onClose).not.toHaveBeenCalled();
});
it('drag dismissal respects a new Reduce Motion setting and current height', () => {
  const f = mount(); mockWindow = { ...mockWindow, height: 600 }; f.update(); act(() => f.pan().onPanResponderRelease({}, { dy: 100, vy: 0 }));
  expect(Animated.timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 600 }));
  mockReduced = true; f.update(); act(() => f.pan().onPanResponderRelease({}, { dy: 100, vy: 0 })); expect(f.props.onClose).toHaveBeenCalledTimes(1);
});
it('Reduce Motion closes immediately exactly once for back or escape', () => {
  mockReduced = true; const f = mount(); expect(animations).toHaveLength(0);
  act(() => { f.modal().props.onAccessibilityEscape(); f.modal().props.onRequestClose(); }); expect(f.props.onClose).toHaveBeenCalledTimes(1); expect(animations).toHaveLength(0);
});
it('preserves drag-only-grabber and leaves child scrolling independent', () => {
  const f = mount(); const pan = f.pan(); expect(pan.onStartShouldSetPanResponder()).toBe(false);
  expect(pan.onMoveShouldSetPanResponder({}, { dx: 3, dy: 9 })).toBe(true); expect(pan.onMoveShouldSetPanResponder({}, { dx: 20, dy: 9 })).toBe(false);
  expect(pan.onMoveShouldSetPanResponder({}, { dx: 0, dy: -20 })).toBe(false);
  const draggable = f.tree.root.findAll(n => n.props.onResponderRelease === pan.onPanResponderRelease); expect(draggable.every(n => n.props.testID === 'bottom-sheet-grabber')).toBe(true);
});
it('small drag springs back and termination restores without closing', () => {
  const f = mount(); act(() => f.pan().onPanResponderRelease({}, { dy: 30, vy: 0 })); expect(Animated.spring).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0, bounciness: 8 }));
  act(() => f.pan().onPanResponderTerminate()); expect(f.props.onClose).not.toHaveBeenCalled();
});
it('rotation interrupts an old dismissal completion and keeps the current sheet open', () => {
  const f = mount(); act(() => f.modal().props.onRequestClose()); const old = animations[1]; mockWindow = { ...mockWindow, height: 500 }; f.update();
  act(() => old.callback!({ finished: true })); expect(f.props.onClose).not.toHaveBeenCalled();
});
it('adds a visible44px Close action and cream surface only with optional appearance', () => {
  const f = mount(); expect(f.button('Close')).toBeUndefined(); const original = f.sheetStyle().backgroundColor;
  f.update({ appearance: { fonts: AfterglowFallbackFonts } }); expect(f.sheetStyle().backgroundColor).toBe(AfterglowColors.paper); expect(original).not.toBe(AfterglowColors.paper);
  expect(StyleSheet.flatten(f.button('Close').props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
});
it('preserves opt-in spring entry and snappier dismissal', () => {
  const f = mount({ springMotion: true }); expect(Animated.spring).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ stiffness: 280, damping: 26 }));
  act(() => f.button('Close sheet').props.onPress()); expect(Animated.spring).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ stiffness: 320, damping: 30 }));
});
