import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SaveSnackbar } from '../SaveSnackbar';
import { AfterglowFonts } from '../../constants/Typography';

// Keep the real snackbar/timer logic. Hold the native animation completion so
// an old worklet can deliberately finish after its visible receipt retires.
const mockAnimationCompletions: Array<() => void> = [];
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  withTiming: (value: number, _config: unknown, complete?: (finished: boolean) => void) => {
    if (complete) mockAnimationCompletions.push(() => complete(true));
    return value;
  },
  withDelay: (_delay: number, value: number) => value,
  runOnJS: (callback: () => void) => callback,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }) }));

type Props = React.ComponentProps<typeof SaveSnackbar>;
const appearance = { fonts: AfterglowFonts };
const cleanups: Array<() => void> = [];
function mount(changes: Partial<Props> = {}) {
  let props: Props = { visible: true, planId: 'saved-one', planTitle: 'Sunday walk', onShare: jest.fn(), onDismiss: jest.fn(), ...changes };
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<SaveSnackbar {...props} />); });
  let mounted = true;
  const unmount = () => { if (mounted) act(() => tree.unmount()); mounted = false; };
  cleanups.push(unmount);
  return { tree, unmount, get props() { return props; },
    update(next: Partial<Props>) { props = { ...props, ...next }; act(() => tree.update(<SaveSnackbar {...props} />)); },
    share() { return tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Share saved plan')!; },
  };
}
const words = (tree: ReactTestRenderer) => tree.root.findAllByType(Text).map(node => node.props.children);
function beginAutoDismiss() { act(() => jest.advanceTimersByTime(4000)); return mockAnimationCompletions[mockAnimationCompletions.length - 1]; }

beforeEach(() => { jest.useFakeTimers(); mockAnimationCompletions.length = 0; });
afterEach(() => { cleanups.splice(0).forEach(close => close()); jest.clearAllTimers(); jest.useRealTimers(); });

it('keeps default copy and makes the optional confirmation compact without changing the Share destination', () => {
  const legacy = mount(), staged = mount({ appearance });
  expect(words(legacy.tree)).toEqual(['Saved!', ' · Share it with someone?', 'Share']);
  expect(words(staged.tree)).toEqual(['Saved', 'Share']);
  expect(StyleSheet.flatten(staged.share().props.style).minHeight).toBeGreaterThanOrEqual(44);
  expect(staged.share().findByType(Text).props.numberOfLines).toBe(1);
  act(() => staged.share().props.onPress());
  expect(staged.props.onShare).toHaveBeenCalledWith('saved-one');
  expect(staged.props.onDismiss).not.toHaveBeenCalled();
});

it('waits four seconds and a finished dismissal animation before dismissing the current receipt once', () => {
  const fixture = mount({ appearance }), press = fixture.share().props.onPress;
  act(() => jest.advanceTimersByTime(3999));
  expect(fixture.props.onDismiss).not.toHaveBeenCalled();
  expect(mockAnimationCompletions).toHaveLength(0);
  act(() => jest.advanceTimersByTime(1));
  expect(fixture.props.onDismiss).not.toHaveBeenCalled();
  const complete = mockAnimationCompletions[0];
  act(() => { complete(); complete(); press(); });
  expect(fixture.props.onDismiss).toHaveBeenCalledTimes(1);
  expect(fixture.props.onShare).not.toHaveBeenCalled();
});

it('claims Share synchronously so repeated presses and a later timer cannot dispatch another exit', () => {
  const fixture = mount({ appearance }), press = fixture.share().props.onPress;
  const complete = beginAutoDismiss();
  act(() => { press(); press(); complete(); });
  expect(fixture.props.onShare).toHaveBeenCalledTimes(1);
  expect(fixture.props.onDismiss).not.toHaveBeenCalled();
});

it('retains current callback changes without restarting the same plan confirmation', () => {
  const fixture = mount({ appearance }), originalDismiss = fixture.props.onDismiss, latestDismiss = jest.fn();
  act(() => jest.advanceTimersByTime(3000));
  fixture.update({ onDismiss: latestDismiss });
  act(() => jest.advanceTimersByTime(1000));
  expect(mockAnimationCompletions).toHaveLength(1);
  act(() => mockAnimationCompletions[0]());
  expect(originalDismiss).not.toHaveBeenCalled();
  expect(latestDismiss).toHaveBeenCalledTimes(1);
});

it('rejects both the old Share callback and an already-running animation after the plan changes', () => {
  const fixture = mount({ appearance }), oldPress = fixture.share().props.onPress, oldComplete = beginAutoDismiss();
  const newShare = jest.fn(), newDismiss = jest.fn();
  fixture.update({ planId: 'saved-two', planTitle: 'Coffee after the walk', onShare: newShare, onDismiss: newDismiss });
  act(() => { oldPress(); oldComplete(); });
  expect(newShare).not.toHaveBeenCalled();
  expect(newDismiss).not.toHaveBeenCalled();
  act(() => fixture.share().props.onPress());
  expect(newShare).toHaveBeenCalledWith('saved-two');
});

it('gives a new plan its full dismissal interval instead of inheriting the previous plan timer', () => {
  const fixture = mount({ appearance });
  act(() => jest.advanceTimersByTime(3500));
  fixture.update({ planId: 'saved-two' });
  act(() => jest.advanceTimersByTime(500));
  expect(mockAnimationCompletions).toHaveLength(0);
  act(() => jest.advanceTimersByTime(3500));
  expect(mockAnimationCompletions).toHaveLength(1);
  act(() => mockAnimationCompletions[0]());
  expect(fixture.props.onDismiss).toHaveBeenCalledTimes(1);
});

it('retires hidden receipts and allows a fresh confirmation for the same plan', () => {
  const fixture = mount({ appearance }), oldPress = fixture.share().props.onPress, oldComplete = beginAutoDismiss();
  fixture.update({ visible: false });
  expect(fixture.tree.toJSON()).toBeNull();
  act(() => { oldPress(); oldComplete(); });
  expect(fixture.props.onShare).not.toHaveBeenCalled();
  expect(fixture.props.onDismiss).not.toHaveBeenCalled();
  fixture.update({ visible: true });
  act(() => { oldPress(); oldComplete(); });
  expect(fixture.props.onShare).not.toHaveBeenCalled();
  expect(fixture.props.onDismiss).not.toHaveBeenCalled();
  act(() => fixture.share().props.onPress());
  expect(fixture.props.onShare).toHaveBeenCalledTimes(1);
});

it('rejects native completion and retained Share after unmount', () => {
  const fixture = mount({ appearance }), press = fixture.share().props.onPress, complete = beginAutoDismiss();
  fixture.unmount();
  act(() => { press(); complete(); jest.advanceTimersByTime(10_000); });
  expect(fixture.props.onShare).not.toHaveBeenCalled();
  expect(fixture.props.onDismiss).not.toHaveBeenCalled();
});
