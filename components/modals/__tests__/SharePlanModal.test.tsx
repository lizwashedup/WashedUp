import React from 'react';
import { Modal, ScrollView, Share, Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { SharePlanModal, type SharePlanModalProps } from '../SharePlanModal';
import { AfterglowFallbackFonts } from '../../../constants/Typography';

jest.mock('../../../lib/haptics', () => ({ hapticMedium: jest.fn() }));
jest.mock('lucide-react-native', () => ({ Share2: () => null, X: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }) }));
const share = jest.spyOn(Share, 'share');
const appearance = { fonts: AfterglowFallbackFonts };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const action = (root: ReactTestInstance, label: string) => root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
let tree: ReactTestRenderer;
function mount(override: Partial<SharePlanModalProps> = {}) {
  const props: SharePlanModalProps = { visible: true, planId: 'plan-a', planTitle: 'Walk and coffee', variant: 'posted', onClose: jest.fn(), ...override };
  act(() => { tree = create(<SharePlanModal {...props}/>); });
  return { props, update: (next: Partial<SharePlanModalProps>) => { Object.assign(props, next); act(() => tree.update(<SharePlanModal {...props}/>)); } };
}
const text = () => tree.root.findAllByType(Text).map(node => node.props.children).join(' ');
beforeEach(() => share.mockReset().mockResolvedValue({ action: Share.sharedAction }));
afterEach(() => act(() => tree?.unmount()));

it.each([
  [{ slug: 'sunday-walk' }, 'https://washedup.app/plans/sunday-walk'],
  [{ slug: null }, 'https://washedup.app/e/plan-a'],
  [{ slug: null, planId: '' }, 'https://washedup.app'],
])('preserves title/newline/URL and the message-only native share contract (%s)', async (override, url) => {
  mount(override); await act(async () => action(tree.root, 'Share link').props.onPress());
  expect(share).toHaveBeenCalledWith({ message: `Walk and coffee\n${url}` });
});
it('keeps existing caller copy available without optional appearance', () => {
  mount(); expect(text()).toContain('Plan posted!'); expect(text()).toContain("Now let's fill it up!");
  expect(action(tree.root, 'View My Plan')).toBeDefined();
});
it('uses factual staged copy and warning without growth pressure or unsupported delivery/feed claims', () => {
  mount({ appearance, inviteWarning: true });
  expect(text()).toContain('Share plan'); expect(text()).toContain('Send the link to someone who might want to come.');
  expect(text()).toContain('We couldn’t confirm the invitation request.');
  expect(text()).not.toMatch(/Plan posted|fill it up|brand new|reach everyone|in the feed|delivered/);
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(1);
  expect(tree.root.findAllByType(Text).find(node => node.props.children === 'Walk and coffee\nhttps://washedup.app/e/plan-a')!.props.numberOfLines).toBeUndefined();
});
it.each(['posted', 'joined'] as const)('uses the original single close callback for the staged %s destination', variant => {
  const fixture = mount({ appearance, variant }); const exit = action(tree.root, variant === 'posted' ? 'View plan' : 'Open chat').props.onPress;
  act(() => { exit(); exit(); tree.root.findByType(Modal).props.onRequestClose(); });
  expect(fixture.props.onClose).not.toHaveBeenCalled();
  expect(tree.root.findByType(Modal).props.visible).toBe(false);
  act(() => { tree.root.findByType(Modal).props.onDismiss(); tree.root.findByType(Modal).props.onDismiss(); });
  expect(fixture.props.onClose).toHaveBeenCalledTimes(1); expect(share).not.toHaveBeenCalled();
});
it('locks two immediate Share taps until native sharing settles, then allows a deliberate new share', async () => {
  const pending = deferred<any>(); share.mockReturnValueOnce(pending.promise); mount({ appearance });
  const press = action(tree.root, 'Share link').props.onPress; act(() => { void press(); void press(); });
  expect(share).toHaveBeenCalledTimes(1); expect(action(tree.root, 'Share link').props.disabled).toBe(true);
  await act(async () => { pending.resolve({ action: Share.dismissedAction }); await pending.promise; });
  expect(text()).not.toMatch(/shared successfully|copied|sent/i);
  await act(async () => action(tree.root, 'Share link').props.onPress()); expect(share).toHaveBeenCalledTimes(2);
});
it('retires an old Share callback after closing, reopening, or changing the plan', async () => {
  const fixture = mount({ appearance }); const oldShare = action(tree.root, 'Share link').props.onPress;
  act(() => action(tree.root, 'Close share screen').props.onPress()); await act(async () => oldShare()); expect(share).not.toHaveBeenCalled();
  fixture.update({ visible: false }); fixture.update({ visible: true }); await act(async () => oldShare()); expect(share).not.toHaveBeenCalled();
  const reopened = action(tree.root, 'Share link').props.onPress; fixture.update({ planId: 'plan-b', planTitle: 'New plan' }); await act(async () => reopened()); expect(share).not.toHaveBeenCalled();
  await act(async () => action(tree.root, 'Share link').props.onPress()); expect(share).toHaveBeenCalledWith({ message: 'New plan\nhttps://washedup.app/e/plan-b' });
});
it('shows a current share failure with retry, but keeps late failure out of a reopened screen', async () => {
  share.mockRejectedValueOnce(new Error('native unavailable')); const fixture = mount({ appearance });
  await act(async () => action(tree.root, 'Share link').props.onPress()); expect(text()).toContain('Couldn’t open sharing. Try again.');
  const pending = deferred<any>(); share.mockReturnValueOnce(pending.promise); act(() => { void action(tree.root, 'Share link').props.onPress(); });
  fixture.update({ visible: false }); fixture.update({ visible: true });
  await act(async () => { pending.reject(new Error('old failure')); try { await pending.promise; } catch {} });
  expect(text()).not.toContain('Couldn’t open sharing. Try again.'); expect(action(tree.root, 'Share link').props.disabled).toBe(false);
});
