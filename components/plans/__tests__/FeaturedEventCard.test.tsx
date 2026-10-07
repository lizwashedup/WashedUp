import React from 'react';
import { ActionSheetIOS, ActivityIndicator, Platform, Share, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Image } from 'expo-image';
import { FeaturedEventCard } from '../FeaturedEventCard';
import { BrandedAlert } from '../../BrandedAlert';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { AfterglowFonts, Fonts } from '../../../constants/Typography';
import { buildPlanShareContent } from '../../../lib/sharePlan';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticMedium: jest.fn(), hapticSelection: jest.fn() }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));

type Props = React.ComponentProps<typeof FeaturedEventCard>;
const appearance = { fonts: AfterglowFonts };
const plan: Props['plan'] = {
  id: 'featured-1', title: 'A long Sunday by the sea with time for a walk and coffee',
  host_message: 'Come along, even if you do not know anyone yet.',
  start_time: '2040-09-16T17:00:00.000Z', location_text: 'Ocean Park, Santa Monica',
  category: 'Outdoors', max_invites: 7, member_count: 7,
  slug: 'sunday-by-the-sea', is_featured: true, featured_type: 'washedup_event',
  creator: { first_name_display: 'Amelia', profile_photo_url: 'mock:amelia' },
  attendees: Array.from({ length: 7 }, (_, index) => ({ profile_photo_url: index === 2 ? null : `mock:attendee-${index}` })),
};
const mounted: ReactTestRenderer[] = [];
const originalOS = Platform.OS;
function mount(props: Partial<Props> = {}) {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<FeaturedEventCard plan={plan} {...props} />); });
  mounted.push(tree);
  return tree;
}
const text = (tree: ReactTestRenderer) => tree.root.findAllByType(Text).flatMap(node => [node.props.children].flat(Infinity)).filter(value => typeof value === 'string' || typeof value === 'number').map(String);
const control = (tree: ReactTestRenderer, label: string) => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!;
const outer = (tree: ReactTestRenderer) => tree.root.findAllByType(TouchableOpacity).find(node => typeof node.props.onLongPress === 'function')!;
function pending<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
afterEach(() => { act(() => mounted.splice(0).forEach(tree => tree.unmount())); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS }); });

it('keeps the default creator-first presentation and opts into title-first identity and full-color photos', () => {
  const legacy = mount(), staged = mount({ appearance, solo: true });
  expect(text(legacy).indexOf('Amelia posted')).toBeLessThan(text(legacy).indexOf(plan.title));
  expect(text(staged).indexOf(plan.title)).toBeLessThan(text(staged).indexOf('Amelia'));
  expect(text(staged)).toContain('posted');
  const legacyTitle = legacy.root.findAllByType(Text).find(node => node.props.children === plan.title)!;
  const title = staged.root.findAllByType(Text).find(node => node.props.children === plan.title)!;
  expect(StyleSheet.flatten(legacyTitle.props.style).fontFamily).toBe(Fonts.displayBold);
  expect(legacyTitle.props.numberOfLines).toBe(2);
  expect(StyleSheet.flatten(title.props.style)).toMatchObject({ fontFamily: AfterglowFonts.semibold, color: AfterglowColors.ink });
  expect(title.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(outer(staged).props.style)).toMatchObject({ borderRadius: 16, width: '100%', backgroundColor: AfterglowColors.white });
  const portrait = staged.root.findAllByType(Image).find(node => node.props.source.uri === 'mock:amelia')!;
  expect(StyleSheet.flatten(portrait.props.style)).toMatchObject({ width: 36, height: 36 });
  expect(StyleSheet.flatten(portrait.props.style).opacity).toBeUndefined();
  expect(staged.root.findAllByType(Image).filter(node => String(node.props.source.uri).startsWith('mock:attendee-'))).toHaveLength(4);
  expect(text(staged)).toEqual(expect.arrayContaining(['+', '2']));
});

it.each([false, true])('keeps the same detail destination and member state even when the source count is full (%s)', isMember => {
  const tree = mount({ appearance, isMember });
  expect(text(tree)).toContain(isMember ? 'Going ✓' : "Let's Go →");
  expect(text(tree).join(' ')).not.toContain('Waitlist');
  const cta = control(tree, isMember ? 'Going, view plan' : "Let's Go, view plan");
  expect(StyleSheet.flatten(cta.props.style).minHeight).toBe(44);
  if (isMember) expect(StyleSheet.flatten(cta.props.style)).toMatchObject({ backgroundColor: Colors.goingConfirmedFill, borderColor: Colors.gold });
  act(() => { outer(tree).props.onPress(); cta.props.onPress(); });
  expect(mockPush.mock.calls).toEqual([['/plan/featured-1'], ['/plan/featured-1']]);
});

it('keeps the exact saved-state callback and does not open or join the plan', () => {
  const onWishlist = jest.fn(), tree = mount({ appearance, onWishlist, isWishlisted: true });
  const stopPropagation = jest.fn(), save = control(tree, 'Remove from saved');
  expect(StyleSheet.flatten(save.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
  act(() => { save.props.onPress({ stopPropagation }); });
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(onWishlist).toHaveBeenCalledWith('featured-1', true);
  expect(mockPush).not.toHaveBeenCalled();
});

it.each(['pending', 'disabled'] as const)('keeps a visible saved control while blocking %s writes', state => {
  const onWishlist = jest.fn(), tree = mount({ appearance, onWishlist, wishlistPending: state === 'pending', wishlistDisabled: state === 'disabled' });
  const save = control(tree, 'Save plan');
  expect(save.props.disabled).toBe(true);
  expect(save.props.accessibilityState).toMatchObject({ disabled: true, busy: state === 'pending' });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(state === 'pending' ? 1 : 0);
  act(() => { save.props.onPress({ stopPropagation: jest.fn() }); });
  expect(onWishlist).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

it.each(['washedup_event', 'birthday_party', 'special_event'] as const)('retains the %s featured identity with readable staged copy', featured_type => {
  const tree = mount({ appearance, plan: { ...plan, featured_type } });
  const label = featured_type === 'birthday_party' ? 'Birthday party' : featured_type === 'special_event' ? 'Special event' : 'WashedUp event';
  expect(text(tree)).toContain(label);
  if (featured_type === 'birthday_party') expect(text(tree)).toContain('Celebrating our original WashedUp users');
});

it('retains Pride artwork at full color beside the featured label and preserves LA logistics and URL-location suppression', () => {
  const tree = mount({ appearance, plan: { ...plan, slug: 'washedup-weho-pride-2026', location_text: 'https://maps.example.test/place' } });
  const artwork = tree.root.findAllByType(Image).find(node => node.props.pointerEvents === 'none')!;
  expect(StyleSheet.flatten(artwork.props.style)).toMatchObject({ width: 24, height: 16 });
  expect(StyleSheet.flatten(artwork.props.style).opacity).toBeUndefined();
  expect(text(tree).join(' ')).toContain('10:00 AM');
  expect(text(tree).join(' ')).not.toContain('maps.example');
});

it.each([true, false])('preserves the native share message and URL contract (slug=%s)', hasSlug => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  const source = { ...plan, slug: hasSlug ? plan.slug : null };
  const tree = mount({ appearance, plan: source });
  const stopPropagation = jest.fn();
  act(() => { void control(tree, 'Share plan').props.onPress({ stopPropagation }); });
  const content = buildPlanShareContent(source);
  expect(share).toHaveBeenCalledWith({ message: `${content.message}\n${content.url}` });
  expect(stopPropagation).toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

it('locks duplicate native sharing until cancellation settles, then allows an intentional retry', async () => {
  const first = pending<Awaited<ReturnType<typeof Share.share>>>();
  const share = jest.spyOn(Share, 'share').mockReturnValueOnce(first.promise).mockResolvedValue({ action: Share.dismissedAction });
  const tree = mount({ appearance }), press = control(tree, 'Share plan').props.onPress;
  let active!: Promise<void>;
  act(() => { active = press({}); void press({}); });
  expect(share).toHaveBeenCalledTimes(1);
  await act(async () => { first.resolve({ action: Share.dismissedAction }); await active; });
  await act(async () => { await press({}); });
  expect(share).toHaveBeenCalledTimes(2);
  expect(tree.root.findAllByType(BrandedAlert)).toHaveLength(0);
});

it('catches a current native share failure in the existing alert and allows retry', async () => {
  const share = jest.spyOn(Share, 'share').mockRejectedValueOnce(new Error('Native sharing unavailable')).mockResolvedValue({ action: Share.dismissedAction });
  const tree = mount({ appearance });
  await act(async () => { await control(tree, 'Share plan').props.onPress({}); });
  const alert = tree.root.findByType(BrandedAlert);
  expect(alert.props).toMatchObject({ appearance, title: 'Couldn’t open sharing', message: 'Try again.' });
  act(() => { alert.props.onClose(); });
  await act(async () => { await control(tree, 'Share plan').props.onPress({}); });
  expect(share).toHaveBeenCalledTimes(2);
});

it.each(['replacement', 'unmount'] as const)('retires a late share failure and old press callback after %s', async transition => {
  const first = pending<Awaited<ReturnType<typeof Share.share>>>();
  const share = jest.spyOn(Share, 'share').mockReturnValueOnce(first.promise).mockResolvedValue({ action: Share.dismissedAction });
  const tree = mount({ appearance }), oldPress = control(tree, 'Share plan').props.onPress;
  let active!: Promise<void>;
  act(() => { active = oldPress({}); });
  if (transition === 'replacement') act(() => { tree.update(<FeaturedEventCard plan={{ ...plan, id: 'featured-2' }} appearance={appearance} />); });
  else act(() => { tree.unmount(); });
  await act(async () => { first.reject(new Error('Old failure')); await active; await oldPress({}); });
  expect(share).toHaveBeenCalledTimes(1);
  if (transition === 'replacement') {
    expect(tree.root.findAllByType(BrandedAlert)).toHaveLength(0);
    await act(async () => { await control(tree, 'Share plan').props.onPress({}); });
    expect(share).toHaveBeenCalledTimes(2);
  }
});

it('preserves the iOS report and block choices and exact plan IDs', () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
  const onReport = jest.fn(), onBlock = jest.fn(), tree = mount({ appearance, onReport, onBlock });
  act(() => { outer(tree).props.onLongPress(); });
  expect(sheet.mock.calls[0][0]).toMatchObject({ options: ['Report this plan', 'Block Amelia', 'Cancel'], cancelButtonIndex: 2, destructiveButtonIndex: 1 });
  act(() => { sheet.mock.calls[0][1](0); sheet.mock.calls[0][1](1); });
  expect(onReport).toHaveBeenCalledWith('featured-1');
  expect(onBlock).toHaveBeenCalledWith('featured-1');
});

it('preserves the non-iOS report and block confirmation with optional appearance', () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const onReport = jest.fn(), onBlock = jest.fn(), tree = mount({ appearance, onReport, onBlock });
  act(() => { outer(tree).props.onLongPress(); });
  const alert = tree.root.findByType(BrandedAlert);
  expect(alert.props.appearance).toEqual(appearance);
  act(() => { alert.props.buttons[0].onPress(); alert.props.buttons[1].onPress(); });
  expect(onReport).toHaveBeenCalledWith('featured-1');
  expect(onBlock).toHaveBeenCalledWith('featured-1');
});

it.each(['cancelled', 'completed'])('keeps %s Featured plan history reachable without a Going/Join claim', status => {
  const tree = mount({ plan: { ...plan, status }, isMember: true, appearance });
  expect(text(tree)).toContain(status === 'cancelled' ? 'Cancelled' : 'Completed');
  expect(text(tree)).toContain('View plan →');
  expect(text(tree).join(' ')).not.toMatch(/Going ✓|Let's Go/);
  act(() => control(tree, `${status === 'cancelled' ? 'Cancelled' : 'Completed'}, view plan`).props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/plan/featured-1');
});
it('ends a Featured plan at its explicit cutoff while mounted', () => {
  const now = Date.now();
  const tree = mount({ plan: { ...plan, start_time: new Date(now - 3600000).toISOString(), end_time: new Date(now + 1000).toISOString() }, appearance });
  act(() => jest.advanceTimersByTime(1000));
  expect(text(tree)).toEqual(expect.arrayContaining(['Ended', 'View plan →']));
});
