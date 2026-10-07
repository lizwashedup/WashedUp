import React from 'react';
import { SectionList, TouchableOpacity, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import MyPlansView from '../MyPlansView';
let mockPlans: any[] = [];
const mockEmpty: any[] = [];
jest.mock('../../../../hooks/useMyPlansData', () => ({ useMyPlans: () => ({ data: mockPlans }), useMyPlanDrafts: () => ({ data: mockEmpty }), useWaitlistedPlans: () => ({ data: mockEmpty }), useInterestedPlans: () => ({ data: mockEmpty }), useSavedPlans: () => ({ data: mockEmpty }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }), useMutation: () => ({ mutate: jest.fn() }), useQueryClient: () => ({}) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: {} }) }));
jest.mock('../../../../hooks/useBlock', () => ({ useBlock: () => ({ blockUser: jest.fn() }) }));
jest.mock('../../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticError: jest.fn() }));
jest.mock('../../../creator/pages/PageFrame', () => ({ PageAction: () => null }));
jest.mock('../../../plans/PlanCard', () => ({ PlanCard: () => null }));
jest.mock('../../../SkeletonCard', () => ({ SkeletonFeed: () => null }));
jest.mock('../../../MiniProfileCard', () => () => null);
jest.mock('../../../modals/ReportModal', () => ({ ReportModal: () => null }));
jest.mock('../../../SaveSnackbar', () => ({ SaveSnackbar: () => null }));
jest.mock('../../../ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('../../../BrandedAlert', () => ({ BrandedAlert: () => null }));
let tree: ReturnType<typeof create>;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(Date.parse('2030-09-14T20:00:00Z')); });
afterEach(() => { if (tree) act(() => tree.unmount()); jest.clearAllTimers(); jest.useRealTimers(); });
it('uses explicit end times for Upcoming/Past and moves a mounted plan at its cutoff', () => {
  mockPlans = [
    { id: 'long', title: 'Long afternoon', status: 'active', start_time: '2030-09-14T12:00:00Z', end_time: '2030-09-14T20:00:01Z' },
    { id: 'short', title: 'Quick coffee', status: 'active', start_time: '2030-09-14T19:00:00Z', end_time: '2030-09-14T19:30:00Z' },
    { id: 'completed', title: 'Finished early', status: 'completed', start_time: '2030-09-15T20:00:00Z' },
  ];
  act(() => { tree = create(<MyPlansView userId="viewer" />); });
  const sections = () => tree.root.findByType(SectionList).props.sections;
  expect(sections().find((section: any) => section.title === 'Upcoming').data.map((row: any) => row.id)).toEqual(['long']);
  const past = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === 'Past'))!;
  act(() => past.props.onPress());
  expect(sections().find((section: any) => section.title === 'Past').data.map((row: any) => row.id)).toEqual(['completed', 'short']);
  act(() => jest.advanceTimersByTime(1000));
  expect(sections().some((section: any) => section.title === 'Upcoming')).toBe(false);
  expect(sections().find((section: any) => section.title === 'Past').data.map((row: any) => row.id)).toEqual(['completed', 'short', 'long']);
});
