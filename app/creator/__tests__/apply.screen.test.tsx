import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import Screen from '../apply';
import { BrandedAlert } from '../../../components/BrandedAlert';
import type { OperatorGrant } from '../../../lib/operatorApplications';

const mockPush = jest.fn(), mockBack = jest.fn(), mockRefetch = jest.fn(), mockInvalidate = jest.fn(), mockWithdraw = jest.fn();
let mockGrants: OperatorGrant[] = [], mockLoading = false;
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  Stack: { Screen: () => null },
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../../../hooks/useCreatorApplicationStatus',()=>({useCreatorApplicationStatus:()=>{require('react').useEffect(()=>{mockRefetch();},[]);return{grants:mockGrants,isLoading:mockLoading,error:null,signedOut:false,refresh:async()=>mockRefetch(),current:()=>true};}}));
jest.mock('../../../constants/FeatureFlags',()=>({CREATOR_PAGES_ENABLED:true}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockGrants, isLoading: mockLoading, refetch: mockRefetch }),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock('../../../lib/operatorApplications', () => ({
  fetchMyGrants: jest.fn(),
  withdrawOperatorApplication: (...args: unknown[]) => mockWithdraw(...args),
}));
jest.mock('../../../components/ProfileButton', () => () => null);
jest.mock('../../../hooks/useAfterglowFonts', () => ({
  useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').CreatorFonts }),
}));
jest.mock('../../../components/BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticSuccess: jest.fn() }));

let tree: ReactTestRenderer;
const controls = () => tree.root.findAllByType(TouchableOpacity);
const control = (label: string) => controls().find(node => node.props.accessibilityLabel === label)!;
const texts = () => tree.root.findAllByType(Text).map(node => node.props.children);
const mount = () => act(() => { tree = create(<Screen />); });
const grant = (track: OperatorGrant['track'], status: OperatorGrant['status'], extra = {}): OperatorGrant => ({
  id: `${track}-grant`, track, status, ...extra,
} as OperatorGrant);

beforeEach(() => {
  jest.clearAllMocks(); mockGrants = []; mockLoading = false;
  mockWithdraw.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { if (tree) act(() => tree.unmount()); });

it('presents Community before Organization with accurate held-review copy and the existing independent routes', () => {
  mount();
  expect(texts()).toContain('Be a part of the Scene.');
  expect(texts()).toContain('We’ll review new applications when the refreshed Scene is ready.');
  expect(texts()).toContain('Bring your community or organization to Scene. Choose one, or apply for both.');
  expect(controls().map(node => node.props.accessibilityLabel).filter(label => label?.startsWith('Apply for'))).toEqual(['Apply for a community', 'Apply for an organization']);
  act(() => control('Apply for a community').props.onPress());
  act(() => control('Apply for an organization').props.onPress());
  expect(mockPush.mock.calls).toEqual([['/creator/apply-community'], ['/creator/apply-events']]);
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});

it('keeps track titles and descriptions in full-width wrappers and all action targets at least 44 points', () => {
  mockGrants = [grant('community_leader', 'applied')]; mount();
  const choice = control('Apply for a community');
  expect([View, 'View']).toContain(choice.parent!.type);
  expect(StyleSheet.flatten(choice.parent!.props.style)).toMatchObject({ width: '100%', alignSelf: 'stretch', minWidth: 0 });
  expect(StyleSheet.flatten(choice.props.style)).toMatchObject({ alignSelf: 'stretch', minWidth: 0, minHeight: 44 });
  const description = choice.findAllByType(Text).find(node => node.props.children === 'An ongoing group people join, with conversations and events that bring everyone together.')!;
  const heading = choice.findAllByType(View).find(node => StyleSheet.flatten(node.props.style)?.flexDirection === 'row')!;
  expect(heading.findAll(node => node === description)).toHaveLength(0);
  expect(description.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(description.props.style).height).toBeUndefined();
  for (const label of ['Withdraw community application', 'See the difference between a community and an organization']) {
    expect(StyleSheet.flatten(control(label).props.style).minHeight).toBeGreaterThanOrEqual(44);
  }
  expect(StyleSheet.flatten(control('Back').props.style).height).toBeGreaterThanOrEqual(44);
  expect(choice.findAllByType(TouchableOpacity)).toHaveLength(1);
});

it.each(['applied', 'in_review', 'approved', 'revoked'] as const)('preserves the locked application selector for %s', status => {
  mockGrants = [grant('community_leader', status)]; mount();
  const choice = control('Apply for a community');
  expect(choice.props.disabled).toBe(true);
  act(() => choice.props.onPress());
  expect(mockPush).not.toHaveBeenCalled();
  expect(controls().some(node => node.props.accessibilityLabel === 'Withdraw community application')).toBe(status === 'applied' || status === 'in_review');
});

it.each(['needs_more_info', 'declined', 'withdrawn'] as const)('preserves the resumable application route for %s', status => {
  mockGrants = [grant('community_leader', status, { applicant_message: 'Please add a link.' })]; mount();
  expect(control('Apply for a community').props.disabled).toBe(false);
  act(() => control('Apply for a community').props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/creator/apply-community');
  if (status === 'needs_more_info') expect(texts()).toContain('More information requested: Please add a link.');
});

it('keeps the complete long status outside the disabled selector and confirms withdrawal before dispatch', async () => {
  mockGrants = [grant('community_leader', 'in_review')]; mount();
  const withdraw = control('Withdraw community application');
  expect(control('Apply for a community').findAll(node => node === withdraw)).toHaveLength(0);
  act(() => withdraw.props.onPress());
  expect(mockWithdraw).not.toHaveBeenCalled();
  const alert = tree.root.findByType(BrandedAlert);
  expect(alert.props.buttons[0]).toMatchObject({ text: 'Keep it', style: 'cancel' });
  let finish!: () => void;
  mockWithdraw.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  act(() => { pending = alert.props.buttons[1].onPress(); });
  expect(control('Withdraw community application').props.disabled).toBe(true);
  expect(mockWithdraw).toHaveBeenCalledWith('community_leader-grant');
  await act(async () => { finish(); await pending; });
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['my-operator-grants'] });
  expect(control('Withdraw community application').props.disabled).toBe(false);
});

it('keeps a failed withdrawal visible and allows another attempt', async () => {
  mockGrants = [grant('community_leader', 'applied')]; mockWithdraw.mockRejectedValue(Error('Offline')); mount();
  act(() => control('Withdraw community application').props.onPress());
  await act(async () => tree.root.findByType(BrandedAlert).props.buttons[1].onPress());
  expect(tree.root.findByType(BrandedAlert).props.title).toBe('That did not go through');
  expect(control('Withdraw community application').props.disabled).toBe(false);
  expect(mockInvalidate).not.toHaveBeenCalled();
});

it('keeps the comparison optional, ordered Community first, and preserves Back', () => {
  mount();
  const comparison = 'See the difference between a community and an organization';
  expect(control(comparison).props.accessibilityState.expanded).toBe(false);
  act(() => control(comparison).props.onPress());
  expect(control(comparison).props.accessibilityState.expanded).toBe(true);
  const copy = texts();
  expect(copy.indexOf('A group people can join and keep coming back to. Includes shared conversations and events.')).toBeLessThan(copy.indexOf('A place to publish events for your business, venue, team, or yourself. Does not include an ongoing member group.'));
  act(() => control('Back').props.onPress());
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('retains the initial-loading state without exposing an unconfirmed application status', () => {
  mockLoading = true; mount();
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(controls().some(node => node.props.accessibilityLabel?.startsWith('Apply for'))).toBe(false);
});

it.each(['community_leader','event_host'] as const)('opens approved %s in the guarded creator chooser without starting another application',track=>{
 mockGrants=[grant(track,'approved')];mount();const label=track==='community_leader'?'Open community creator space':'Open organization creator space';
 act(()=>control(label).props.onPress());expect(mockPush).toHaveBeenCalledWith('/creator/pages');expect(mockWithdraw).not.toHaveBeenCalled();
});
