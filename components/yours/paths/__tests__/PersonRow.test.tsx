import React from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import { act, create } from 'react-test-renderer';
import PersonRow from '../PersonRow';
import { AfterglowFallbackFonts, AfterglowType } from '../../../../constants/Typography';
import { AfterglowColors } from '../../../../constants/Colors';
jest.mock('expo-image', () => ({ Image: (props: unknown) => require('react').createElement('ProfileImage', props) }));
jest.mock('../../primitives/YoursAvatar', () => ({ __esModule: true, default: (props: unknown) => require('react').createElement('LegacyAvatar', props) }));
const cleanup: Array<() => void> = [];
function mount(extra: Partial<React.ComponentProps<typeof PersonRow>> = {}) {
  let props = { name: 'Amelia', photoUrl: 'https://example.invalid/amelia.jpg', sharedCount: 2, state: 'none' as const, onAdd: jest.fn(), onPressPerson: jest.fn(), appearance: { fonts: AfterglowFallbackFonts }, ...extra };
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<PersonRow {...props} />); }); cleanup.push(() => act(() => tree.unmount()));
  return { tree, props, update: (next: Partial<React.ComponentProps<typeof PersonRow>>) => { props = { ...props, ...next }; act(() => tree.update(<PersonRow {...props} />)); },
    text: () => tree.root.findAllByType(Text).map(n => n.props.children).flat().join(' '),
    press: (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0],
    photo: () => tree.root.findAllByType('ProfileImage' as any)[0],
  };
}
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
it('keeps the legacy avatar and styling opt-out intact', () => {
  const f = mount({ appearance: undefined }); expect(f.tree.root.findByType('LegacyAvatar' as any).props).toMatchObject({ size: 48, bucket: 'none', photoUrl: 'https://example.invalid/amelia.jpg' });
  expect(f.photo()).toBeUndefined(); expect(f.text()).toContain('2 plans together');
});
it('keeps full-color54px portraits and readable shared-plan context in the staged row', () => {
  const f = mount(); expect(StyleSheet.flatten(f.photo().props.style)).toMatchObject({ width: 54, height: 54, opacity: 1 });
  expect(f.text()).toContain('2 shared plans'); const name = f.tree.root.findAllByType(Text).find(n => n.props.children === 'Amelia')!;
  expect(StyleSheet.flatten(name.props.style)).toMatchObject({ ...AfterglowType.title, color: AfterglowColors.ink, fontFamily: AfterglowFallbackFonts.semibold });
  expect(name.props.numberOfLines).toBeUndefined();
});
it('uses initial fallback after a failed image and retries when identity/photo changes', () => {
  const f = mount(); const oldError = f.photo().props.onError; act(() => oldError()); expect(f.photo()).toBeUndefined(); expect(f.text()).toContain('A');
  f.update({ name: 'Luca', photoUrl: 'https://example.invalid/luca.jpg' }); expect(f.photo()).toBeDefined();
  act(() => oldError()); expect(f.photo().props.source.uri).toBe('https://example.invalid/luca.jpg');
});
it('shows a readable fallback with blank name or absent image, no invented activity', () => {
  const f = mount({ name: ' ', photoUrl: null, sharedCount: 0 }); expect(f.text()).toContain('Someone'); expect(f.photo()).toBeUndefined();
  expect(f.text()).not.toContain('shared plan'); expect(f.press('View Someone')).toBeDefined();
});
it('keeps Add separate from opening the person and gives it at least44px height', () => {
  const f = mount(); act(() => f.press('Add Amelia')!.props.onPress()); expect(f.props.onAdd).toHaveBeenCalledTimes(1); expect(f.props.onPressPerson).not.toHaveBeenCalled();
  expect(StyleSheet.flatten(f.press('Add Amelia')!.props.style).minHeight).toBeGreaterThanOrEqual(44);
  act(() => f.press('View Amelia')!.props.onPress()); expect(f.props.onPressPerson).toHaveBeenCalledTimes(1);
});
it('incoming View opens existing minimal-person flow without promising request decisions', () => {
  const f = mount({ state: 'incoming' }); expect(f.press('Add Amelia')).toBeUndefined(); act(() => f.press('View profile for Amelia')!.props.onPress());
  expect(f.props.onPressPerson).toHaveBeenCalledTimes(1); expect(f.props.onAdd).not.toHaveBeenCalled(); expect(f.text()).toContain('View'); expect(f.text()).not.toContain('Respond');
});
it('shows Sending until confirmed, disables only the request action and keeps name accessible', () => {
  const f = mount({ isAdding: true }); const button = f.press('Sending request to Amelia')!;
  expect(button.props.disabled).toBe(true); expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(f.text()).toContain('Sending…'); expect(f.press('View Amelia')!.props.disabled).not.toBe(true);
});
it('requested and connected states have no duplicate Add; Requested stays explicit', () => {
  const f = mount({ state: 'requested' }); expect(f.text()).toContain('Requested'); expect(f.press('Add Amelia')).toBeUndefined();
  f.update({ state: 'connected' }); expect(f.text()).not.toContain('Requested'); expect(f.press('Add Amelia')).toBeUndefined();
});
it('does not let legacy Add bubbling also open a person', () => {
  const f = mount({ appearance: undefined }); const add = f.press('Add Amelia')!;
  const stopPropagation = jest.fn(); act(() => add.props.onPress({ stopPropagation })); expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(f.props.onAdd).toHaveBeenCalledTimes(1); expect(f.props.onPressPerson).not.toHaveBeenCalled();
});
