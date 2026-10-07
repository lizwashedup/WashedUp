const mockNotificationRequest = jest.fn();
jest.mock('../../../lib/planNotificationPrompt', () => ({ requestPlanNotificationPrompt: (...args: any[]) => mockNotificationRequest(...args) }));
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { Keyboard, ScrollView, StyleSheet, TextInput } from 'react-native';
import { AfterglowFonts } from '../../../constants/Typography';
import { AfterglowColors } from '../../../constants/Colors';
import CategoryChips from '../../composer/CategoryChips';
import CollapsibleCalendar from '../../composer/CollapsibleCalendar';
import TimePicker from '../../composer/TimePicker';
import PlacePicker from '../../composer/place/PlacePicker';
import PeoplePickerSheet from '../PeoplePickerSheet';
import PlanComposerV2 from '../PlanComposerV2';
import PostConfirmation from '../../composer/PostConfirmation';
import { SharePlanModal } from '../../modals/SharePlanModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../lib/supabase';
import EditorialTitleField from '../../composer/EditorialTitleField';
import InvitePeopleSection from '../InvitePeopleSection';
import { BrandedAlert } from '../../BrandedAlert';

const mockInvite = jest.fn(), mockInsert = jest.fn(), mockMember = jest.fn();
const mockProfile = jest.fn();
const mockRollback = jest.fn(), mockCommit = jest.fn();
const mockPush = jest.fn(), mockReplace = jest.fn(), mockBack = jest.fn();
const mockPermission = jest.fn(), mockChoosePhoto = jest.fn(), mockPreparePhoto = jest.fn(), mockUpload = jest.fn();
let mockAfterglow = false, mockFocused = true, mockCanGoBack = false;
let mockParams: Record<string, string>;
let mockViewerId: string | null | undefined = 'creator', mockViewerEpoch = 1;
let mockViewerLoading = false, mockViewerError: Error | null = null;
const mockRetryIdentity = jest.fn();
const mockClient = { getQueryData: jest.fn(), setQueryData: jest.fn(), invalidateQueries: jest.fn().mockResolvedValue(undefined) };
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockClient }));
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args), replace: (...args: unknown[]) => mockReplace(...args), setParams: (params: Record<string, string>) => { mockParams = { ...mockParams, ...params }; }, canGoBack: () => mockCanGoBack, back: (...args: unknown[]) => mockBack(...args) }, useLocalSearchParams: () => mockParams }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (callback: () => (() => void) | undefined) => {
  require('react').useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]);
} }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFonts, loaded: true }) }));
jest.mock('expo-image-picker', () => ({ requestMediaLibraryPermissionsAsync: () => mockPermission(), launchImageLibraryAsync: (...args: unknown[]) => mockChoosePhoto(...args) }));
jest.mock('expo-image-manipulator', () => ({ SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: (...args: unknown[]) => mockPreparePhoto(...args) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const epoch = mockViewerEpoch;
  const isCurrent = require('react').useCallback(() => mockViewerEpoch === epoch, [epoch]);
  return { viewerId: mockViewerId, epoch, isCurrent, error: mockViewerError, isLoading: mockViewerLoading, retry: mockRetryIdentity };
} }));
jest.mock('../../../hooks/useInvitePeopleToPlan', () => ({ useInvitePeopleToPlan: () => ({ mutateAsync: mockInvite }) }));
jest.mock('../../../hooks/useInviteInterestSignals', () => ({ useInviteInterestSignals: () => ({ data: [] }) }));
jest.mock('../../../hooks/useDismissSuggestion', () => ({ useDismissSuggestion: () => ({ dismiss: { mutate: jest.fn() }, undo: jest.fn() }) }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticMedium: jest.fn(), hapticSelection: jest.fn(), hapticSuccess: jest.fn() }));
jest.mock('../../../lib/contentFilter', () => ({ checkContent: () => ({ ok: true }) }));
jest.mock('../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: (...args: unknown[]) => mockUpload(...args) }));
jest.mock('../../../lib/url', () => ({ extractFirstUrl: () => null }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITIES_ENABLED: true, get COMMUNITY_CHAT_GROUPING_ENABLED() { return mockAfterglow; } }));
jest.mock('../../../lib/optimisticPlans', () => ({ buildOptimisticPlan: () => ({}), prependOptimisticPlan: () => ({ tempId: 'optimistic-test', rollback: mockRollback, commit: mockCommit }) }));
jest.mock('../../../lib/supabase', () => ({ supabase: {
  auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'creator' } }, error: null }), refreshSession: jest.fn().mockResolvedValue({ error: null }) },
  from: (table: string) => {
    if (table === 'profiles') return { select: () => ({ eq: (_field: string, id: string) => ({ single: () => mockProfile(id) }) }) };
    if (table === 'events') return { insert: (row: unknown) => ({ select: () => ({ single: () => mockInsert(row) }), then: (resolve: (result: unknown) => void, reject: (error: unknown) => void) => mockInsert(row).then(resolve, reject) }) };
    if (table === 'event_members') return { insert: (row: unknown) => mockMember(row) };
    throw new Error(`Unexpected table ${table}`);
  },
} }));
jest.mock('react-native-safe-area-context', () => {
  const make = require('react').createElement, View = require('react-native').View;
  return { SafeAreaView: (props: unknown) => make(View, props), useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('lucide-react-native', () => ({ ImagePlus: () => null, X: () => null, ChevronDown: () => null }));
jest.mock('../../BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../modals/SharePlanModal', () => ({ SharePlanModal: jest.fn(() => null) }));
jest.mock('../../composer/PostConfirmation', () => ({ __esModule: true, default: jest.fn(() => null) }));
jest.mock('../PeoplePickerSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../InvitePeopleSection', () => ({ __esModule: true, default: () => null }));
jest.mock('../../composer/EditorialTitleField', () => ({ __esModule: true, default: () => null }));
jest.mock('../../composer/CategoryChips', () => ({ __esModule: true, default: () => null }));
jest.mock('../../composer/CollapsibleCalendar', () => ({ __esModule: true, default: () => null }));
jest.mock('../../composer/TimePicker', () => ({ __esModule: true, default: () => null, displayTime: () => '8:00 PM' }));
jest.mock('../../composer/InlineNudge', () => ({ __esModule: true, default: () => null }));
jest.mock('../../composer/nudgeArbiter', () => ({ useNudgeArbiter: ({ recoveryActive }: { recoveryActive: boolean }) => recoveryActive ? 'recovery' : null, NUDGE_PLACE_BASE: '' }));
jest.mock('../../composer/place/PlacePicker', () => ({ __esModule: true, default: () => null }));
const cleanup: Array<() => void> = [];
function byLabel(tree: ReturnType<typeof create>, label: string) {
  return tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
}
function pressByLabel(tree: ReturnType<typeof create>, label: string) { return byLabel(tree, label).props.onPress(); }
function field(tree: ReturnType<typeof create>, label: string) {
  return tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0];
}
function photoUris(tree: ReturnType<typeof create>): string[] { return tree.root.findAll(node => typeof node.props.source?.uri === 'string').map(node => node.props.source.uri); }
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }

function measureSection(child: ReactTestInstance, y: number) {
  let section = child.parent;
  while (section && typeof section.props.onLayout !== 'function') section = section.parent;
  if (!section) throw new Error('The field must be inside a measured composer section');
  const measuredSection = section;
  act(() => measuredSection.props.onLayout({ nativeEvent: { layout: { x: 0, y, width: 390, height: 120 } } }));
}

function navigationSpies(tree: ReturnType<typeof create>) {
  // React Native's Jest components expose native methods on their instances,
  // which are also the values assigned to the composer's refs.
  const scrollTo = jest.fn(), titleFocus = jest.fn(), messageFocus = jest.fn(), descriptionFocus = jest.fn();
  tree.root.findByType(ScrollView).instance.scrollTo = scrollTo;
  tree.root.findByType(EditorialTitleField).props.inputRef.current = { focus: titleFocus };
  tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Your message, required')!.instance.focus = messageFocus;
  tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Description, required')!.instance.focus = descriptionFocus;
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  cleanup.push(() => dismiss.mockRestore());
  return { scrollTo, titleFocus, messageFocus, descriptionFocus, dismiss };
}

it('reveals the measured title section and clamps the scroll target at the top', async () => {
  const form = await mount();
  const nav = navigationSpies(form.tree);
  form.setTitle('');
  measureSection(form.tree.root.findByType(EditorialTitleField), 8);
  await act(async () => { await pressByLabel(form.tree, 'Post'); });
  expect(nav.scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: true });
  expect(nav.titleFocus).toHaveBeenCalledTimes(1);
  expect(nav.messageFocus).not.toHaveBeenCalled();
  expect(nav.dismiss).not.toHaveBeenCalled();

  measureSection(form.tree.root.findByType(EditorialTitleField), 128);
  await act(async () => { await form.post(); });
  expect(nav.scrollTo).toHaveBeenLastCalledWith({ y: 116, animated: true });
  expect(nav.titleFocus).toHaveBeenCalledTimes(2);
  expect(mockInsert).not.toHaveBeenCalled();
});

it('moves to the next incomplete measured section as category, message and description are corrected', async () => {
  const form = await mount(false, { prefillStartTime: '' });
  const nav = navigationSpies(form.tree);
  act(() => {
    form.tree.root.findByType(CategoryChips).props.onSelect(null);
    field(form.tree, 'Your message, required').props.onChangeText('Hi');
    field(form.tree, 'Description, required').props.onChangeText('');
  });
  measureSection(form.tree.root.findByType(CategoryChips), 332);
  measureSection(field(form.tree, 'Your message, required'), 600);
  measureSection(field(form.tree, 'Description, required'), 870);
  measureSection(form.tree.root.findByType(CollapsibleCalendar), 1160);

  await act(async () => { await form.post(); });
  expect(nav.scrollTo).toHaveBeenLastCalledWith({ y: 320, animated: true });
  expect(nav.dismiss).toHaveBeenCalledTimes(1);
  expect(nav.titleFocus).not.toHaveBeenCalled();
  expect(nav.messageFocus).not.toHaveBeenCalled();
  expect(nav.descriptionFocus).not.toHaveBeenCalled();

  act(() => form.tree.root.findByType(CategoryChips).props.onSelect('Outdoors'));
  // Inline errors may move following sections; the next attempt must use
  // the new layout measurement, not the initial position or a fixed offset.
  measureSection(field(form.tree, 'Your message, required'), 650);
  await act(async () => { await form.post(); });
  expect(nav.scrollTo).toHaveBeenLastCalledWith({ y: 638, animated: true });
  expect(nav.messageFocus).toHaveBeenCalledTimes(1);
  expect(nav.descriptionFocus).not.toHaveBeenCalled();
  expect(nav.dismiss).toHaveBeenCalledTimes(1);

  act(() => field(form.tree, 'Your message, required').props.onChangeText('Come take a walk with me.'));
  measureSection(field(form.tree, 'Description, required'), 940);
  await act(async () => { await form.post(); });
  expect(nav.scrollTo).toHaveBeenLastCalledWith({ y: 928, animated: true });
  expect(nav.messageFocus).toHaveBeenCalledTimes(1);
  expect(nav.descriptionFocus).toHaveBeenCalledTimes(1);

  act(() => field(form.tree, 'Description, required').props.onChangeText('A walk by the water.'));
  measureSection(form.tree.root.findByType(CollapsibleCalendar), 1240);
  await act(async () => { await form.post(); });
  expect(nav.scrollTo).toHaveBeenLastCalledWith({ y: 1228, animated: true });
  expect(nav.dismiss).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(form.tree.toJSON())).toContain('Choose a day and a start time.');
  expect(nav.titleFocus).not.toHaveBeenCalled();
  expect(nav.descriptionFocus).toHaveBeenCalledTimes(1);
  expect(mockInsert).not.toHaveBeenCalled();
});

it.each<[Record<string, string>, string]>([
  [{ prefillStartTime: '', prefillEventDate: '2040-09-14' }, 'Choose a start time.'],
  [{ prefillStartTime: '20:00' }, 'Choose a day for your plan.'],
])('reveals the when section and dismisses the keyboard when only one date/time value is missing: %s', async (params, error) => {
  const form = await mount(false, params);
  const nav = navigationSpies(form.tree);
  measureSection(form.tree.root.findByType(CollapsibleCalendar), 1492);
  await act(async () => { await form.saveDraft(); });
  expect(nav.scrollTo).toHaveBeenCalledWith({ y: 1480, animated: true });
  expect(nav.dismiss).toHaveBeenCalledTimes(1);
  expect(nav.titleFocus).not.toHaveBeenCalled();
  expect(nav.messageFocus).not.toHaveBeenCalled();
  expect(nav.descriptionFocus).not.toHaveBeenCalled();
  expect(JSON.stringify(form.tree.toJSON())).toContain(error);
  expect(mockInsert).not.toHaveBeenCalled();
});

it('points to a missing title without posting or clearing the entered message', async () => {
  const form = await mount();
  form.setTitle('   ');
  const focus = jest.fn();
  form.tree.root.findByType(EditorialTitleField).props.inputRef.current = { focus };
  await act(async () => { await form.post(); });
  expect(focus).toHaveBeenCalledTimes(1);
  expect(form.tree.root.findByType(EditorialTitleField).props.error).toBe('Add a title for your plan.');
  expect(field(form.tree, 'Your message, required').props.value).toBe('Come take a walk with me.');
  expect(mockInsert).not.toHaveBeenCalled();
  form.setTitle('A sunset walk');
  expect(form.tree.root.findByType(EditorialTitleField).props.error).toBeUndefined();
});

it('shows every incomplete publish section and clears corrected fields independently', async () => {
  const form = await mount();
  act(() => {
    form.tree.root.findByType(CategoryChips).props.onSelect(null);
    field(form.tree, 'Your message, required').props.onChangeText('Hi');
    field(form.tree, 'Description, required').props.onChangeText('');
  });
  await act(async () => { await form.post(); });
  expect(JSON.stringify(form.tree.toJSON())).toContain('Choose a category.');
  expect(field(form.tree, 'Your message, required').props.accessibilityHint).toContain('at least 10');
  expect(field(form.tree, 'Description, required').props.accessibilityHint).toContain('Add a description');
  expect(mockInsert).not.toHaveBeenCalled();
  act(() => form.tree.root.findByType(CategoryChips).props.onSelect('Outdoors'));
  expect(JSON.stringify(form.tree.toJSON())).not.toContain('Choose a category.');
  expect(field(form.tree, 'Your message, required').props.value).toBe('Hi');
});

it('keeps optional publish details optional when saving a draft', async () => {
  const form = await mount();
  form.setTitle('');
  act(() => {
    form.tree.root.findByType(CategoryChips).props.onSelect(null);
    field(form.tree, 'Your message, required').props.onChangeText('');
    field(form.tree, 'Description, required').props.onChangeText('');
  });
  await act(async () => { await form.saveDraft(); });
  expect(form.tree.root.findByType(EditorialTitleField).props.error).toBeDefined();
  expect(field(form.tree, 'Your message, required').props.accessibilityHint).toBeUndefined();
  expect(field(form.tree, 'Description, required').props.accessibilityHint).toBeUndefined();
  expect(mockInsert).not.toHaveBeenCalled();
});

async function mount(invite = false, params: Record<string, string> = {}) {
  mockParams = { prefillTitle: 'Local test walk', prefillCategory: 'Outdoors', prefillDescription: 'A local test plan.', prefillStartTime: '2040-09-15T03:00:00.000Z', ...(invite ? { prefillInvitePersonId: 'person', prefillInvitePersonName: 'Person' } : {}), ...params };
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<PlanComposerV2 />); });
  cleanup.push(() => act(() => tree.unmount()));
  await flush();
  act(() => tree.root.findAll(node => node.props.accessibilityLabel === 'Your message, required' && typeof node.props.onChangeText === 'function')[0].props.onChangeText('Come take a walk with me.'));
  const post = () => tree.root.findAll(node => typeof node.props.onPress === 'function' && node.findAll(child => ['post the plan', 'Post plan'].includes(child.props.children)).length > 0)[0].props.onPress();
  return { tree, post,
    focus: async (value: boolean) => { mockFocused = value; act(() => tree.update(<PlanComposerV2 />)); await flush(); },
    pick: () => pressByLabel(tree, 'Add photo'),
    confirmation: () => tree.root.findByType(PostConfirmation).props,
    postCallback: () => tree.root.findAll(node => typeof node.props.onPress === 'function' && node.findAll(child => ['post the plan', 'Post plan'].includes(child.props.children)).length > 0)[0].props.onPress,
    saveDraft: () => tree.root.findAll(node => typeof node.props.onPress === 'function' && node.findAll(child => ['save it as a draft', 'Save draft'].includes(child.props.children)).length > 0)[0].props.onPress(),
    prefillNew: async (newTitle: string) => {
      mockParams = { prefillTitle: newTitle, prefillCategory: 'Outdoors', prefillDescription: 'The current account plan.', prefillStartTime: '2040-09-15T03:00:00.000Z' };
      act(() => tree.update(<PlanComposerV2 />));
      await flush();
      act(() => tree.root.findAll(node => node.props.accessibilityLabel === 'Your message, required' && typeof node.props.onChangeText === 'function')[0].props.onChangeText('Current account plan message.'));
    },
    title: () => tree.root.findByType(EditorialTitleField).props.value,
    setTitle: (value: string) => act(() => tree.root.findByType(EditorialTitleField).props.onChangeText(value)),
    swap: async (id: string | null = 'next-account') => {
      mockViewerId = id; mockViewerEpoch++;
      jest.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: id ? { id } : null }, error: null } as any);
      act(() => tree.update(<PlanComposerV2 />));
      await flush();
    },
  };
}
beforeEach(() => { jest.clearAllMocks(); mockAfterglow = false; mockFocused = true; mockCanGoBack = false;
  mockPermission.mockReset().mockResolvedValue({ status: 'granted' });
  mockChoosePhoto.mockReset().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///chosen.jpg' }] });
  mockPreparePhoto.mockReset().mockResolvedValue({ uri: 'file:///prepared.jpg', base64: 'prepared-base64' });
  mockUpload.mockReset().mockResolvedValue('https://test.invalid/creator-photo.jpg');
  jest.mocked(supabase.auth.refreshSession).mockReset().mockResolvedValue({ error: null } as any); mockViewerId = 'creator'; mockViewerEpoch = 1; mockViewerLoading = false; mockViewerError = null; jest.mocked(supabase.auth.getUser).mockReset().mockResolvedValue({ data: { user: { id: 'creator' } }, error: null } as any); mockProfile.mockReset().mockResolvedValue({ data: { gender: 'woman' }, error: null }); mockInsert.mockReset().mockResolvedValue({ data: { id: 'saved-plan' }, error: null }); mockMember.mockReset().mockResolvedValue({ error: null }); mockInvite.mockReset().mockResolvedValue(1); });
afterEach(() => { cleanup.splice(0).forEach(close => close()); jest.useRealTimers(); });

it('blocks confirmation exits while an actual zero-recipient plan insert is pending', async () => {
  let resolve!: (value: unknown) => void;
  mockInsert.mockReturnValue(new Promise(yes => { resolve = yes; }));
  const fixture = await mount();
  let pending!: Promise<void>;
  act(() => { pending = fixture.post(); });
  await flush();
  expect(fixture.confirmation().visible).toBe(true);
  expect(fixture.confirmation().invitationStatus).toBe('none');
  expect(fixture.confirmation().planReady).toBe(false);
  expect(fixture.confirmation().canContinue()).toBe(false);
  act(() => { fixture.confirmation().onShare(); fixture.confirmation().onSeePlans(); });
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(fixture.tree.root.findByType(SharePlanModal).props.visible).toBe(false);
  await act(async () => { resolve({ data: { id: 'saved-plan' }, error: null }); await pending; });
  expect(fixture.confirmation().planReady).toBe(true);
  expect(fixture.confirmation().canContinue()).toBe(true);
});

it('returns through existing recovery when the insert yields no confirmed plan id', async () => {
  mockInsert.mockResolvedValue({ data: null, error: null });
  const fixture = await mount(true);
  await act(async () => { await fixture.post(); });
  expect(mockMember).not.toHaveBeenCalled();
  expect(mockInvite).not.toHaveBeenCalled();
  expect(mockRollback).toHaveBeenCalledTimes(1);
  expect(fixture.confirmation().visible).toBe(false);
  expect(fixture.confirmation().invitationStatus).toBe('none');
  expect(JSON.stringify(fixture.tree.toJSON())).toMatch(/that didn't go through/);
});

it('retries an unconfirmed invitation using the saved plan without repeating plan or membership creation', async () => {
  mockInvite.mockRejectedValueOnce(new Error('unknown invite result'));
  const fixture = await mount(true);
  await act(async () => { await fixture.post(); });
  await flush();
  expect(fixture.confirmation().invitationStatus).toBe('unconfirmed');
  expect(fixture.confirmation().canRetryInvites).toBe(true);
  act(() => fixture.confirmation().onRetryInvites());
  await flush();
  expect(fixture.confirmation().invitationStatus).toBe('confirmed');
  expect(mockInsert).toHaveBeenCalledTimes(1);
  expect(mockMember).toHaveBeenCalledTimes(1);
  expect(mockInvite.mock.calls).toEqual([
    [{ eventId: 'saved-plan', recipientIds: ['person'] }],
    [{ eventId: 'saved-plan', recipientIds: ['person'] }],
  ]);
});

it('does not enter post recovery when only saving the local celebration preference fails', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null);
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('local storage unavailable'));
  const fixture = await mount(true);
  await act(async () => { await fixture.post(); });
  await flush();
  expect(fixture.confirmation().visible).toBe(true);
  expect(fixture.confirmation().planReady).toBe(true);
  expect(fixture.confirmation().invitationStatus).toBe('confirmed');
  expect(mockRollback).not.toHaveBeenCalled();
  expect(mockInsert).toHaveBeenCalledTimes(1);
  expect(mockMember).toHaveBeenCalledTimes(1);
});

function pendingResult<T = any>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

it('does not create under a different account returned by the delayed post identity check', async () => {
  const fixture = await mount(true), identity = pendingResult();
  jest.mocked(supabase.auth.getUser).mockReturnValueOnce(identity.promise);
  let pending!: Promise<void>;
  act(() => { pending = fixture.post(); });
  await fixture.swap();
  fixture.setTitle('NEXT_ACCOUNT_DRAFT');
  await act(async () => { identity.resolve({ data: { user: { id: 'next-account' } }, error: null }); await pending; });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(mockMember).not.toHaveBeenCalled();
  expect(mockInvite).not.toHaveBeenCalled();
  expect(fixture.title()).toBe('NEXT_ACCOUNT_DRAFT');
  expect(fixture.confirmation().visible).toBe(false);
});

it.each([false, true])('retires an event insert before starting creator membership (account round trip: %s)', async roundTrip => {
  const fixture = await mount(true), event = pendingResult();
  mockInsert.mockReturnValueOnce(event.promise);
  let pending!: Promise<void>;
  act(() => { pending = fixture.post(); });
  await flush();
  expect(mockInsert).toHaveBeenCalledTimes(1);
  await fixture.swap();
  if (roundTrip) await fixture.swap('creator');
  fixture.setTitle('CURRENT_DRAFT');
  await act(async () => { event.resolve({ data: { id: 'old-saved-plan' }, error: null }); await pending; });
  expect(mockMember).not.toHaveBeenCalled();
  expect(mockInvite).not.toHaveBeenCalled();
  expect(mockCommit).not.toHaveBeenCalled();
  expect(fixture.title()).toBe('CURRENT_DRAFT');
  expect(fixture.confirmation().visible).toBe(false);
});

it('ignores a retired creator-membership completion without exposing the old confirmation or clearing the current draft', async () => {
  const fixture = await mount(true), member = pendingResult();
  mockMember.mockReturnValueOnce(member.promise);
  let pending!: Promise<void>;
  act(() => { pending = fixture.post(); });
  await flush();
  expect(mockMember).toHaveBeenCalledTimes(1);
  await fixture.swap();
  fixture.setTitle('CURRENT_ACCOUNT_DRAFT');
  await act(async () => { member.resolve({ error: null }); await pending; });
  expect(mockInvite).not.toHaveBeenCalled();
  expect(mockCommit).not.toHaveBeenCalled();
  expect(fixture.title()).toBe('CURRENT_ACCOUNT_DRAFT');
  expect(fixture.confirmation().planReady).toBe(false);
  expect(fixture.confirmation().visible).toBe(false);
});

it('does not let a retired failure put the new account into recovery', async () => {
  const fixture = await mount(true), event = pendingResult();
  mockInsert.mockReturnValueOnce(event.promise);
  let pending!: Promise<void>;
  act(() => { pending = fixture.post(); });
  await flush();
  await fixture.swap();
  fixture.setTitle('CURRENT_ACCOUNT_DRAFT');
  await act(async () => { event.resolve({ data: null, error: new Error('old request failure') }); await pending; });
  expect(fixture.title()).toBe('CURRENT_ACCOUNT_DRAFT');
  expect(JSON.stringify(fixture.tree.toJSON())).not.toMatch(/that didn't go through/);
  expect(fixture.confirmation().visible).toBe(false);
});

it('does not continue writes after unmount while an event insertion is pending', async () => {
  const fixture = await mount(true), event = pendingResult();
  mockInsert.mockReturnValueOnce(event.promise);
  let pending!: Promise<void>;
  act(() => { pending = fixture.post(); });
  await flush();
  act(() => fixture.tree.unmount());
  await act(async () => { event.resolve({ data: { id: 'saved-before-unmount' }, error: null }); await pending; });
  expect(mockMember).not.toHaveBeenCalled();
  expect(mockInvite).not.toHaveBeenCalled();
});

it('clears account-owned fields and recipients, and refuses a retained post callback after sign-out', async () => {
  const fixture = await mount(true), oldPost = fixture.postCallback();
  await fixture.swap(null);
  expect(fixture.title()).toBe('');
  expect(fixture.tree.root.findByType(InvitePeopleSection).props.invited).toEqual([]);
  await act(async () => { await oldPost(); });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(fixture.tree.root.findByType(BrandedAlert).props.visible).toBe(false);
});

it('requires a known starting account and leaves identity failure retryable', async () => {
  mockViewerId = undefined;
  mockViewerError = new Error('identity unavailable');
  const fixture = await mount(true);
  await act(async () => { await fixture.post(); });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(mockRetryIdentity).toHaveBeenCalledTimes(1);
  expect(fixture.tree.root.findByType(BrandedAlert).props.title).toBe('Check your account');
});

it('rejects an inconsistent identity read even before the account observer publishes a change', async () => {
  const fixture = await mount(true);
  jest.mocked(supabase.auth.getUser).mockResolvedValueOnce({ data: { user: { id: 'another-account' } }, error: null } as any);
  await act(async () => { await fixture.post(); });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(mockRollback).toHaveBeenCalledTimes(1);
  expect(fixture.title()).toBe('Local test walk');
});

it('removes only the retired temporary card and does not unlock or roll back a newer attempt', async () => {
  const fixture = await mount(true), oldEvent = pendingResult(), newEvent = pendingResult();
  mockInsert.mockReturnValueOnce(oldEvent.promise).mockReturnValueOnce(newEvent.promise);
  let oldPost!: Promise<void>, newPost!: Promise<void>;
  act(() => { oldPost = fixture.post(); });
  await flush();
  await fixture.swap();
  await fixture.swap('creator');
  const removeOld = mockClient.setQueryData.mock.calls.find(([key]) => JSON.stringify(key) === JSON.stringify(['my-plans', 'creator']))?.[1];
  expect(removeOld([{ id: 'newer-existing-plan' }, { id: 'optimistic-test' }])).toEqual([{ id: 'newer-existing-plan' }]);
  expect(mockRollback).not.toHaveBeenCalled();
  await fixture.prefillNew('NEW_ATTEMPT');
  const retainedNewPost = fixture.postCallback();
  act(() => { newPost = retainedNewPost(); });
  await flush();
  await act(async () => { oldEvent.resolve({ data: null, error: new Error('retired failure') }); await oldPost; });
  expect(fixture.confirmation().visible).toBe(true);
  expect(fixture.confirmation().planTitle).toBe('NEW_ATTEMPT');
  await act(async () => { await retainedNewPost(); });
  expect(mockInsert).toHaveBeenCalledTimes(2);
  expect(mockRollback).not.toHaveBeenCalled();
  await act(async () => { newEvent.resolve({ data: { id: 'current-plan' }, error: null }); await newPost; });
  expect(mockCommit).toHaveBeenCalledTimes(1);
  expect(mockCommit).toHaveBeenCalledWith('current-plan');
});

it('does not retry creator membership after the account changes during the existing delay', async () => {
  jest.useFakeTimers();
  const fixture = await mount(true);
  mockMember.mockResolvedValueOnce({ error: new Error('retryable member failure') });
  let pending!: Promise<void>;
  act(() => { pending = fixture.post(); });
  await flush();
  expect(mockMember).toHaveBeenCalledTimes(1);
  await fixture.swap();
  await act(async () => { jest.advanceTimersByTime(500); await pending; });
  expect(mockMember).toHaveBeenCalledTimes(1);
  expect(mockInvite).not.toHaveBeenCalled();
});

it('keeps the confirmed cache row but ignores a retired celebration-storage completion', async () => {
  const storage = pendingResult<void>();
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null);
  jest.mocked(AsyncStorage.setItem).mockReturnValueOnce(storage.promise);
  const fixture = await mount();
  let pending!: Promise<void>;
  act(() => { pending = fixture.post(); });
  await flush();
  expect(mockCommit).toHaveBeenCalledWith('saved-plan');
  await fixture.swap();
  fixture.setTitle('CURRENT_DRAFT');
  await act(async () => { storage.resolve(); await pending; });
  expect(fixture.title()).toBe('CURRENT_DRAFT');
  expect(mockRollback).not.toHaveBeenCalled();
  expect(mockClient.setQueryData).not.toHaveBeenCalled();
});

it('does not navigate or reopen sharing from retained confirmation callbacks after an account change', async () => {
  jest.useFakeTimers();
  const fixture = await mount();
  await act(async () => { await fixture.post(); });
  const oldConfirmation = fixture.confirmation();
  const oldShare = fixture.tree.root.findByType(SharePlanModal).props;
  act(() => oldConfirmation.onSeePlans());
  await fixture.swap();
  act(() => { oldConfirmation.onShare(); oldConfirmation.onSeePlans(); oldShare.onClose(); jest.advanceTimersByTime(500); });
  expect(oldConfirmation.canContinue()).toBe(false);
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(fixture.tree.root.findByType(SharePlanModal).props.visible).toBe(false);
});

it('does not save a draft under a replacement account or clear its current form on a late save', async () => {
  const fixture = await mount(), identity = pendingResult();
  jest.mocked(supabase.auth.getUser).mockReturnValueOnce(identity.promise);
  let saving!: Promise<void>;
  act(() => { saving = fixture.saveDraft(); });
  await fixture.swap();
  fixture.setTitle('CURRENT_DRAFT');
  await act(async () => { identity.resolve({ data: { user: { id: 'next-account' } }, error: null }); await saving; });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(fixture.title()).toBe('CURRENT_DRAFT');
  expect(fixture.tree.root.findByType(BrandedAlert).props.visible).toBe(false);

  await fixture.prefillNew('Current draft save');
  const saved = pendingResult();
  mockInsert.mockReturnValueOnce(saved.promise);
  act(() => { saving = fixture.saveDraft(); });
  await flush();
  expect(mockInsert.mock.calls[0][0]).toMatchObject({ creator_user_id: 'next-account', status: 'draft' });
  await fixture.swap('creator');
  fixture.setTitle('RETURNED_ACCOUNT_DRAFT');
  await act(async () => { saved.resolve({ error: null }); await saving; });
  expect(fixture.title()).toBe('RETURNED_ACCOUNT_DRAFT');
  expect(fixture.tree.root.findByType(BrandedAlert).props.visible).toBe(false);
});

it('ignores the previous account profile result when choosing audience options', async () => {
  const oldProfile = pendingResult();
  mockProfile.mockReturnValueOnce(oldProfile.promise).mockResolvedValueOnce({ data: { gender: 'man' }, error: null });
  const fixture = await mount();
  await fixture.swap();
  expect(fixture.tree.root.findAll(node => node.props.children === 'Men only').length).toBeGreaterThan(0);
  await act(async () => { oldProfile.resolve({ data: { gender: 'woman' }, error: null }); });
  expect(fixture.tree.root.findAll(node => node.props.children === 'Men only').length).toBeGreaterThan(0);
  expect(fixture.tree.root.findAll(node => node.props.children === 'Women only')).toHaveLength(0);
});

it('preserves creator-membership retry and sends the original invitations only after its success', async () => {
  jest.useFakeTimers();
  const fixture = await mount(true);
  mockMember.mockResolvedValueOnce({ error: new Error('temporary failure') });
  let pending!: Promise<void>;
  act(() => { pending = fixture.post(); });
  await flush();
  expect(mockInvite).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(500); await pending; });
  await flush();
  expect(mockInsert).toHaveBeenCalledTimes(1);
  expect(mockMember.mock.calls).toEqual([
    [{ event_id: 'saved-plan', user_id: 'creator', role: 'host', status: 'joined' }],
    [{ event_id: 'saved-plan', user_id: 'creator', role: 'host', status: 'joined' }],
  ]);
  expect(mockInvite).toHaveBeenCalledWith({ eventId: 'saved-plan', recipientIds: ['person'] });
  expect(mockInvite.mock.invocationCallOrder[0]).toBeGreaterThan(mockMember.mock.invocationCallOrder[1]);
  expect(fixture.confirmation().planReady).toBe(true);
  expect(mockRollback).not.toHaveBeenCalled();
});

it('keeps the default presentation and opts shared fields, alerts and completion into one staged appearance', async () => {
  const legacy = await mount();
  expect(legacy.tree.root.findByType(EditorialTitleField).props.appearance).toBeUndefined();
  expect(legacy.confirmation().appearance).toBeUndefined();
  expect(field(legacy.tree, 'Description, required').props.placeholder).toBe('anything else worth knowing');
  act(() => legacy.tree.unmount());
  mockAfterglow = true;
  const staged = await mount();
  for (const component of [EditorialTitleField, CategoryChips, CollapsibleCalendar, TimePicker, PlacePicker, InvitePeopleSection, PeoplePickerSheet, PostConfirmation, BrandedAlert, SharePlanModal]) {
    const instances = staged.tree.root.findAllByType(component as any);
    expect(instances.length).toBeGreaterThan(0);
    instances.forEach(instance => expect(instance.props.appearance).toEqual({ fonts: AfterglowFonts }));
  }
  expect(staged.tree.root.findByType(EditorialTitleField).props.placeholder).toBe('Sunset hike at Runyon');
  expect(field(staged.tree, 'Description, required').props.placeholder).toBe('Details people need before joining');
  expect(JSON.stringify(staged.tree.toJSON())).toContain(' · required');
  expect(StyleSheet.flatten(byLabel(staged.tree, 'Add photo').props.style)).toMatchObject({ minHeight: 44, borderRadius: 4 });
  expect(StyleSheet.flatten(byLabel(staged.tree, 'Post plan').props.style)).toMatchObject({ minHeight: 48, backgroundColor: AfterglowColors.clay, borderRadius: 4 });
});

it('retains required message and description validation and their original text limits in staged mode', async () => {
  mockAfterglow = true;
  const fixture = await mount();
  const message = field(fixture.tree, 'Your message, required'), description = field(fixture.tree, 'Description, required');
  expect(message.props.maxLength).toBe(150);
  expect(description.props.maxLength).toBe(2000);
  act(() => { message.props.onChangeText('Short'); description.props.onChangeText(''); });
  await act(async () => { await fixture.post(); });
  expect(field(fixture.tree, 'Your message, required').props.accessibilityHint).toBe('Add a message with at least 10 characters.');
  expect(field(fixture.tree, 'Description, required').props.accessibilityHint).toBe('Add a description so people know what to expect.');
  expect(mockInsert).not.toHaveBeenCalled();
});

it('retains the staged plan payload, creator attachment and selected audience without changing limits', async () => {
  mockAfterglow = true;
  const fixture = await mount(true);
  expect(fixture.tree.root.findAll(node => node.props.accessibilityLabel === 'Men only')).toHaveLength(0);
  act(() => { pressByLabel(fixture.tree, 'Women only'); pressByLabel(fixture.tree, '20s'); });
  expect(byLabel(fixture.tree, 'Women only').props.accessibilityState.checked).toBe(true);
  for (let count = 0; count < 4; count++) act(() => pressByLabel(fixture.tree, 'Fewer people'));
  expect(byLabel(fixture.tree, 'Fewer people').props.disabled).toBe(true);
  for (let count = 0; count < 5; count++) act(() => pressByLabel(fixture.tree, 'More people'));
  expect(byLabel(fixture.tree, 'More people').props.disabled).toBe(true);
  await act(async () => { await fixture.post(); });
  expect(mockInsert.mock.calls[0][0]).toMatchObject({
    title: 'Local test walk', start_time: '2040-09-15T03:00:00.000Z', end_time: null,
    creator_user_id: 'creator', primary_vibe: 'outdoors', gender_rule: 'women_only',
    target_age_min: 20, target_age_max: 29, description: 'A local test plan.',
    host_message: 'Come take a walk with me.', max_invites: 7, min_invites: 3,
    drop_in: true, allow_duplicate: true, image_url: null, status: 'forming', city: 'Los Angeles',
  });
  expect(mockMember).toHaveBeenCalledWith({ event_id: 'saved-plan', user_id: 'creator', role: 'host', status: 'joined' });
  expect(mockInvite).toHaveBeenCalledWith({ eventId: 'saved-plan', recipientIds: ['person'] });
});

it('retains the original title/day/time-only draft gate and clearly confirms a staged draft', async () => {
  mockAfterglow = true;
  const fixture = await mount();
  act(() => {
    field(fixture.tree, 'Your message, required').props.onChangeText('');
    field(fixture.tree, 'Description, required').props.onChangeText('');
    fixture.tree.root.findByType(CategoryChips).props.onSelect(null);
  });
  await act(async () => { await fixture.saveDraft(); });
  expect(mockInsert.mock.calls[0][0]).toMatchObject({ status: 'draft', host_message: null, description: null, primary_vibe: null });
  expect(mockMember).not.toHaveBeenCalled();
  expect(fixture.tree.root.findByType(BrandedAlert).props.title).toBe('Draft saved');
});

it('keeps real handles when the shared people picker returns selected people', async () => {
  mockAfterglow = true;
  const fixture = await mount();
  act(() => fixture.tree.root.findByType(PeoplePickerSheet).props.onConfirm([{ user_id: 'new-person', name: 'Amelia', handle: 'amelia', photo: null }]));
  expect(fixture.tree.root.findByType(InvitePeopleSection).props.invited).toEqual([expect.objectContaining({ user_id: 'new-person', handle: 'amelia' })]);
});

it('prepares and uploads one photo under the initiating account before adding its URL to the original post', async () => {
  const fixture = await mount();
  await act(async () => { await fixture.pick(); });
  expect(mockChoosePhoto).toHaveBeenCalledWith({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 10], quality: 1 });
  expect(mockPreparePhoto).toHaveBeenCalledWith('file:///chosen.jpg', [{ resize: { width: 1200 } }], { compress: 0.85, format: 'jpeg', base64: true });
  expect(mockUpload).toHaveBeenCalledWith('event-images', expect.stringMatching(/^creator\/\d+\.jpg$/), 'prepared-base64');
  expect(photoUris(fixture.tree)).toContain('https://test.invalid/creator-photo.jpg');
  expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
  await act(async () => { await fixture.post(); });
  expect(mockInsert.mock.calls[0][0].image_url).toBe('https://test.invalid/creator-photo.jpg');
});

it('locks the system picker immediately and blocks posting while it is pending', async () => {
  const fixture = await mount(), selection = pendingResult();
  mockChoosePhoto.mockReturnValueOnce(selection.promise);
  const pick = byLabel(fixture.tree, 'Add photo').props.onPress;
  const retainedPost = fixture.postCallback();
  const retainedDraft = fixture.tree.root.findAll(node => typeof node.props.onPress === 'function' && node.findAll(child => child.props.children === 'save it as a draft').length > 0)[0].props.onPress;
  let first!: Promise<void>;
  act(() => { first = pick(); void pick(); void retainedPost(); void retainedDraft(); });
  expect(mockChoosePhoto).toHaveBeenCalledTimes(1);
  expect(mockPermission).not.toHaveBeenCalled();
  expect(byLabel(fixture.tree, 'Adding photo').props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  await act(async () => { await fixture.post(); });
  expect(mockInsert).not.toHaveBeenCalled();
  await act(async () => { selection.resolve({ canceled: false, assets: [{ uri: 'file:///chosen.jpg' }] }); await first; });
  expect(mockChoosePhoto).toHaveBeenCalledTimes(1);
  expect(mockUpload).toHaveBeenCalledTimes(1);
});

it.each(['account', 'round-trip', 'blur', 'cancel', 'cancel-root', 'unmount'] as const)('retires native picker completion after %s before preparation or upload', async transition => {
  const fixture = await mount(), selection = pendingResult();
  mockChoosePhoto.mockReturnValueOnce(selection.promise);
  let pending!: Promise<void>;
  act(() => { pending = fixture.pick(); });
  if (transition === 'account' || transition === 'round-trip') await fixture.swap();
  if (transition === 'round-trip') await fixture.swap('creator');
  if (transition === 'blur') await fixture.focus(false);
  if (transition === 'cancel' || transition === 'cancel-root') {
    mockCanGoBack = transition === 'cancel';
    act(() => pressByLabel(fixture.tree, 'Cancel'));
    if (transition === 'cancel') expect(mockBack).toHaveBeenCalledTimes(1);
    else { expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plans'); expect(mockBack).not.toHaveBeenCalled(); }
  }
  if (transition === 'unmount') act(() => fixture.tree.unmount());
  await act(async () => { selection.resolve({ canceled: false, assets: [{ uri: 'file:///chosen.jpg' }] }); await pending; });
  expect(mockChoosePhoto).toHaveBeenCalledTimes(1);
  expect(mockPreparePhoto).not.toHaveBeenCalled();
  expect(mockUpload).not.toHaveBeenCalled();
});

it('does not reactivate photo picking when the account changes while the composer remains blurred', async () => {
  const fixture = await mount();
  await fixture.focus(false);
  await fixture.swap();
  await act(async () => { await fixture.pick(); });
  expect(mockPermission).not.toHaveBeenCalled();
  expect(mockChoosePhoto).not.toHaveBeenCalled();
  await fixture.focus(true);
  await act(async () => { await fixture.pick(); });
  expect(mockUpload).toHaveBeenCalledWith('event-images', expect.stringMatching(/^next-account\//), 'prepared-base64');
});

it.each(['picker', 'preparation'] as const)('does not attach a late %s result to a replacement account', async stage => {
  const fixture = await mount(), deferred = pendingResult();
  if (stage === 'picker') mockChoosePhoto.mockReturnValueOnce(deferred.promise);
  else mockPreparePhoto.mockReturnValueOnce(deferred.promise);
  let pending!: Promise<void>;
  act(() => { pending = fixture.pick(); });
  await flush();
  await fixture.swap();
  await act(async () => {
    deferred.resolve(stage === 'picker' ? { canceled: false, assets: [{ uri: 'file:///old.jpg' }] } : { uri: 'file:///old-prepared.jpg', base64: 'old' });
    await pending;
  });
  expect(mockUpload).not.toHaveBeenCalled();
  expect(photoUris(fixture.tree)).toEqual([]);
});

it.each(['before-refresh', 'after-refresh'] as const)('requires the original authenticated photo owner %s', async when => {
  const fixture = await mount();
  if (when === 'after-refresh') jest.mocked(supabase.auth.getUser).mockResolvedValueOnce({ data: { user: { id: 'creator' } }, error: null } as any);
  jest.mocked(supabase.auth.getUser).mockResolvedValueOnce({ data: { user: { id: 'other-account' } }, error: null } as any);
  await act(async () => { await fixture.pick(); });
  expect(mockUpload).not.toHaveBeenCalled();
  expect(photoUris(fixture.tree)).toEqual([]);
  expect(fixture.tree.root.findByType(BrandedAlert).props.title).toBe('Upload failed');
  expect(byLabel(fixture.tree, 'Add photo').props.disabled).toBe(false);
});

it('clears an unfinished local preview on blur and ignores its old upload during a new visit', async () => {
  const fixture = await mount(), oldUpload = pendingResult(), newUpload = pendingResult();
  mockUpload.mockReturnValueOnce(oldUpload.promise).mockReturnValueOnce(newUpload.promise);
  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = fixture.pick(); });
  await flush();
  expect(photoUris(fixture.tree)).toContain('file:///prepared.jpg');
  await fixture.focus(false);
  expect(photoUris(fixture.tree)).toEqual([]);
  await fixture.focus(true);
  act(() => { second = fixture.pick(); });
  await flush();
  await act(async () => { oldUpload.resolve('https://test.invalid/old.jpg'); await first; });
  expect(photoUris(fixture.tree)).not.toContain('https://test.invalid/old.jpg');
  await act(async () => { await fixture.post(); });
  expect(mockInsert).not.toHaveBeenCalled();
  await act(async () => { newUpload.resolve('https://test.invalid/new.jpg'); await second; });
  expect(photoUris(fixture.tree)).toContain('https://test.invalid/new.jpg');
  await fixture.focus(false);
  await fixture.focus(true);
  expect(photoUris(fixture.tree)).toContain('https://test.invalid/new.jpg');
});

it('does not let an old upload failure clear a new account photo or display a stale alert', async () => {
  const fixture = await mount();
  let rejectOld!: (reason: Error) => void;
  mockUpload.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectOld = reject; }));
  let first!: Promise<void>;
  act(() => { first = fixture.pick(); });
  await flush();
  await fixture.swap();
  await act(async () => { await fixture.pick(); });
  await act(async () => { rejectOld(new Error('old storage error')); await first; });
  expect(photoUris(fixture.tree)).toContain('https://test.invalid/creator-photo.jpg');
  expect(fixture.tree.root.findByType(BrandedAlert).props.visible).toBe(false);
});

it.each(['cancelled', 'chooser-error', 'missing-base64', 'upload-error'] as const)('releases the current photo attempt after %s and permits an intentional retry', async failure => {
  const fixture = await mount();
  if (failure === 'cancelled') mockChoosePhoto.mockResolvedValueOnce({ canceled: true });
  if (failure === 'chooser-error') mockChoosePhoto.mockRejectedValueOnce(new Error('native picker failed'));
  if (failure === 'missing-base64') mockPreparePhoto.mockResolvedValueOnce({ uri: 'file:///no-data.jpg' });
  if (failure === 'upload-error') mockUpload.mockRejectedValueOnce(new Error('storage failed'));
  await act(async () => { await fixture.pick(); });
  expect(byLabel(fixture.tree, 'Add photo').props.disabled).toBe(false);
  const alert = fixture.tree.root.findByType(BrandedAlert).props;
  if (failure === 'cancelled') expect(alert.visible).toBe(false);
  if (failure === 'chooser-error') expect(alert.title).toBe('Couldn’t open photos');
  if (failure === 'missing-base64') expect(alert.title).toBe('Invalid image');
  if (failure === 'upload-error') expect(alert.title).toBe('Upload failed');
  await act(async () => { await fixture.pick(); });
  expect(photoUris(fixture.tree)).toContain('https://test.invalid/creator-photo.jpg');
});


it.each([false, true])('preserves original capitalization in the staged footer and confirmation (staged: %s)', async staged => {
  mockAfterglow = staged;
  const fixture = await mount();
  act(() => {
    fixture.tree.root.findByType(PlacePicker).props.onChange({ name: 'Ocean Park', lat: 34, lng: -118 });
    fixture.tree.root.findByType(PeoplePickerSheet).props.onConfirm([{ user_id: 'riley', name: 'Riley', photo: null }]);
  });
  const expected = staged ? '8:00 PM · Ocean Park · Riley' : '8:00 pm · ocean park · riley';
  expect(JSON.stringify(fixture.tree.toJSON())).toContain(expected);
  await act(async () => { await fixture.post(); });
  expect(fixture.confirmation().metaLine).toContain(expected);
});

it.each(['see', 'share'])('requests notifications only when a confirmed post exits through %s', async action => {
  jest.useFakeTimers(); const fixture = await mount();
  await act(async () => { await fixture.post(); });
  expect(mockNotificationRequest).not.toHaveBeenCalled();
  if (action === 'see') act(() => fixture.confirmation().onSeePlans());
  else { act(() => fixture.confirmation().onShare()); act(() => fixture.tree.root.findByType(SharePlanModal).props.onClose()); }
  expect(mockNotificationRequest).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(400));
  expect(mockNotificationRequest).toHaveBeenCalledTimes(1);
  expect(mockNotificationRequest.mock.calls[0][0]).toEqual({ userId: 'creator', planId: 'saved-plan', reason: 'posted' });
  expect(mockPush).toHaveBeenCalledWith('/plan/saved-plan');
});
it('never requests notifications from a pending, failed or draft post', async () => {
  mockInsert.mockResolvedValueOnce({ data: null, error: null }); const fixture = await mount();
  await act(async () => { await fixture.post(); });
  fixture.confirmation().onSeePlans(); expect(mockNotificationRequest).not.toHaveBeenCalled();
  await act(async () => { await fixture.saveDraft(); }); expect(mockNotificationRequest).not.toHaveBeenCalled();
});
it('drops a delayed post notification handoff after the account changes', async () => {
  jest.useFakeTimers(); const fixture = await mount(); await act(async () => { await fixture.post(); });
  act(() => fixture.confirmation().onSeePlans()); await fixture.swap(); act(() => jest.advanceTimersByTime(400));
  expect(mockNotificationRequest).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});

it.each(['owner', 'refresh', 'owner-after-refresh', 'upload'] as const)('recovers a stalled %s photo stage and ignores its late result after a new photo', async stage => {
  const fixture = await mount(); jest.useFakeTimers();
  const stalled = pendingResult();
  if (stage === 'upload') mockUpload.mockReturnValueOnce(stalled.promise);
  else if (stage === 'refresh') jest.mocked(supabase.auth.refreshSession).mockReturnValueOnce(stalled.promise as any);
  else {
    if (stage === 'owner-after-refresh') jest.mocked(supabase.auth.getUser).mockResolvedValueOnce({ data: { user: { id: 'creator' } }, error: null } as any);
    jest.mocked(supabase.auth.getUser).mockReturnValueOnce(stalled.promise as any);
  }
  let settled = false;
  act(() => { void fixture.pick().then(() => { settled = true; }); }); await flush();
  await act(async () => { jest.advanceTimersByTime(stage === 'upload' ? 30_000 : 12_000); }); await flush();
  expect(settled).toBe(true);
  expect(byLabel(fixture.tree, 'Add photo').props.disabled).toBe(false);
  expect(fixture.tree.root.findByType(BrandedAlert).props.title).toBe('Upload failed');
  expect(mockInsert).not.toHaveBeenCalled();
  await act(async () => { await fixture.pick(); }); await flush();
  expect(photoUris(fixture.tree)).toContain('https://test.invalid/creator-photo.jpg');
  const writes = mockUpload.mock.calls.length;
  await act(async () => { stalled.resolve(stage === 'upload' ? 'https://test.invalid/retired.jpg' : { data: { user: { id: 'creator' } }, error: null }); }); await flush();
  expect(mockUpload).toHaveBeenCalledTimes(writes);
  expect(photoUris(fixture.tree)).not.toContain('https://test.invalid/retired.jpg');
});

it('uses the images-only system picker when broad photo-library permission is denied', async () => {
  mockPermission.mockResolvedValue({ status: 'denied', granted: false, canAskAgain: false });
  const fixture = await mount();
  await act(async () => { await fixture.pick(); });
  expect(mockChoosePhoto).toHaveBeenCalledWith({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 10], quality: 1 });
  expect(mockPermission).not.toHaveBeenCalled();
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(photoUris(fixture.tree)).toContain('https://test.invalid/creator-photo.jpg');
  expect(mockInsert).not.toHaveBeenCalled();
});
