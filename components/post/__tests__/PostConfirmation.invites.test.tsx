import React from 'react';
import { Modal, ScrollView, Text, TouchableOpacity } from 'react-native';
import { act, create } from 'react-test-renderer';
import PostConfirmation from '../../composer/PostConfirmation';
import { AfterglowFonts } from '../../../constants/Typography';
import type { PostPlanInvitationStatus } from '../usePostPlanInvitations';

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../composer/ConfirmationMark', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-reanimated', () => {
  const make = require('react').createElement;
  const { View } = require('react-native');
  const transition = { duration: () => transition, delay: () => transition };
  return { __esModule: true, default: { View: (props: unknown) => make(View, props) }, FadeIn: transition, FadeInUp: transition,
    useSharedValue: (value: number) => ({ value }), useAnimatedStyle: (fn: () => unknown) => fn(), withSpring: (value: number) => value };
});
const cleanup: Array<() => void> = [];
function mount(status: PostPlanInvitationStatus, canRetryInvites = false, planReady = true, staged = false) {
  const onShare = jest.fn(), onSeePlans = jest.fn(), onRetryInvites = jest.fn();
  const canContinue = jest.fn(() => status !== 'sending' && status !== 'waiting');
  let view!: ReturnType<typeof create>;
  act(() => { view = create(<PostConfirmation appearance={staged ? { fonts: AfterglowFonts } : undefined} visible isFirstPlan={false} planTitle="Walk" metaLine="Tomorrow" planReady={planReady}
    invitationStatus={status} canRetryInvites={canRetryInvites} canContinue={canContinue} onRetryInvites={onRetryInvites} onShare={onShare} onSeePlans={onSeePlans} />); });
  cleanup.push(() => act(() => view.unmount()));
  return { view, onShare, onSeePlans, onRetryInvites, canContinue };
}
afterEach(() => cleanup.splice(0).forEach(close => close()));
it('keeps a plan with no invitees on its pending confirmation until the plan is ready', () => {
  const fixture = mount('none', false, false);
  const buttons = fixture.view.root.findAllByType(TouchableOpacity);
  expect(buttons.every(button => button.props.disabled)).toBe(true);
  act(() => { buttons.forEach(button => button.props.onPress()); fixture.view.root.findByType(Modal).props.onRequestClose(); });
  expect(fixture.onShare).not.toHaveBeenCalled();
  expect(fixture.onSeePlans).not.toHaveBeenCalled();
});
it.each(['waiting', 'sending'] as const)('does not claim notification delivery or permit exits while %s', status => {
  const fixture = mount(status, false, status !== 'waiting');
  const text = JSON.stringify(fixture.view.toJSON());
  expect(text).not.toMatch(/have been notified|delivered/);
  if (status === 'waiting') expect(text).not.toMatch(/your plan is live/);
  const buttons = fixture.view.root.findAllByType(TouchableOpacity);
  expect(buttons.every(button => button.props.disabled)).toBe(true);
  act(() => { buttons.forEach(button => button.props.onPress()); fixture.view.root.findByType(Modal).props.onRequestClose(); });
  expect(fixture.onShare).not.toHaveBeenCalled();
  expect(fixture.onSeePlans).not.toHaveBeenCalled();
});
it.each([0, 1])('shows explicit retry and preserves original exit %s', exitIndex => {
  const fixture = mount('unconfirmed', true);
  expect(JSON.stringify(fixture.view.toJSON())).toMatch(/Couldn’t confirm/);
  const buttons = fixture.view.root.findAllByType(TouchableOpacity);
  act(() => buttons.find(button => button.props.accessibilityLabel === 'Retry invitations')!.props.onPress());
  expect(fixture.onRetryInvites).toHaveBeenCalledTimes(1);
  act(() => buttons.filter(button => button.props.accessibilityLabel !== 'Retry invitations')[exitIndex].props.onPress());
  expect(fixture.onShare).toHaveBeenCalledTimes(exitIndex === 0 ? 1 : 0);
  expect(fixture.onSeePlans).toHaveBeenCalledTimes(exitIndex === 1 ? 1 : 0);
});
it('uses the synchronous request guard when an exit callback predates a retry render', () => {
  const fixture = mount('unconfirmed', true);
  const oldExit = fixture.view.root.findAllByType(TouchableOpacity).find(button => button.props.accessibilityLabel !== 'Retry invitations')!.props.onPress;
  fixture.canContinue.mockReturnValue(false);
  act(() => oldExit());
  expect(fixture.onShare).not.toHaveBeenCalled();
});
it('describes successful RPC acknowledgement without a count or delivery claim', () => {
  const fixture = mount('confirmed');
  const text = JSON.stringify(fixture.view.toJSON());
  expect(text).toMatch(/Invitation request confirmed/);
  expect(text).not.toMatch(/have been notified|delivered|Invited \d/);
});

it.each(['View plan', 'Share plan'])('keeps staged content scrollable and %s on its original callback', exitLabel => {
  const fixture = mount('unconfirmed', true, true, true);
  expect(fixture.view.root.findAllByType(ScrollView)).toHaveLength(1);
  expect(fixture.view.root.findAllByType(Text).find(text => text.props.children === 'Walk')!.props.numberOfLines).toBeUndefined();
  expect(JSON.stringify(fixture.view.toJSON())).toMatch(/Your plan is live/);
  expect(JSON.stringify(fixture.view.toJSON())).not.toMatch(/someone has to say yes/);
  const buttons = fixture.view.root.findAllByType(TouchableOpacity);
  act(() => {
    buttons.find(button => button.props.accessibilityLabel === exitLabel)!.props.onPress();
    buttons.find(button => button.props.accessibilityLabel === 'Retry invitations')!.props.onPress();
  });
  expect(fixture.onSeePlans).toHaveBeenCalledTimes(exitLabel === 'View plan' ? 1 : 0);
  expect(fixture.onShare).toHaveBeenCalledTimes(exitLabel === 'Share plan' ? 1 : 0);
  expect(fixture.onRetryInvites).toHaveBeenCalledTimes(1);
});
it('keeps staged pending confirmation honest and blocks the same exits', () => {
  const fixture = mount('waiting', false, false, true);
  expect(JSON.stringify(fixture.view.toJSON())).not.toMatch(/Your plan is live/);
  const buttons = fixture.view.root.findAllByType(TouchableOpacity);
  expect(buttons.every(button => button.props.disabled)).toBe(true);
  act(() => {
    buttons.forEach(button => button.props.onPress());
    fixture.view.root.findByType(Modal).props.onRequestClose();
  });
  expect(fixture.onShare).not.toHaveBeenCalled();
  expect(fixture.onSeePlans).not.toHaveBeenCalled();
});

it.each([false, true])('allows only one exit for a visible confirmation, staged=%s', staged => {
  const fixture = mount('confirmed', false, true, staged);
  const buttons = fixture.view.root.findAllByType(TouchableOpacity);
  act(() => {
    buttons[0].props.onPress();
    buttons[0].props.onPress();
    buttons[1].props.onPress();
    fixture.view.root.findByType(Modal).props.onRequestClose();
  });
  expect(fixture.onShare).toHaveBeenCalledTimes(1);
  expect(fixture.onSeePlans).not.toHaveBeenCalled();
});
it('rejects an exit retained from an unmounted confirmation', () => {
  const fixture = mount('confirmed');
  const exit = fixture.view.root.findAllByType(TouchableOpacity)[0].props.onPress;
  act(() => fixture.view.unmount());
  act(() => exit());
  expect(fixture.onShare).not.toHaveBeenCalled();
});
