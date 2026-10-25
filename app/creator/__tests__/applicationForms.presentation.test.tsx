import React from 'react';
import { Alert, Text, TextInput, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import Community from '../apply-community';
import Organization from '../apply-events';
import { BrandedAlert } from '../../../components/BrandedAlert';
import { ChoiceList, ChipMulti, TermsCheck, SubmitButton, Field } from '../../../components/creator/ApplyFormKit';

const mockPrevent = jest.fn(), mockDispatch = jest.fn(), mockCurrent = jest.fn(() => true);
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ dispatch: mockDispatch }), usePreventRemove: (...args: unknown[]) => mockPrevent(...args) }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => ({ viewerId: 'member', isCurrent: mockCurrent }) }));
const mockBack = jest.fn(), mockSubmit = jest.fn(), mockReadGrants = jest.fn(), mockReadProfile = jest.fn();
let mockUser: { id: string } | null = null;
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }), Stack: { Screen: () => null } }));
jest.mock('../../../components/ProfileButton', () => () => null);
jest.mock('../../../components/BrandedAlert', () => ({ BrandedAlert: () => null }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').CreatorFonts }) }));
jest.mock('../../../lib/operatorApplications', () => ({
  ...jest.requireActual('../../../lib/operatorApplications'),
  submitApplication: (...args: unknown[]) => mockSubmit(...args),
  fetchMyGrants: (...args: unknown[]) => mockReadGrants(...args),
}));
jest.mock('../../../lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: mockUser } }) },
  from: () => ({ select: () => ({ eq: () => ({ single: () => mockReadProfile() }) }) }),
} }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticSuccess: jest.fn(), hapticError: jest.fn(), hapticSelection: jest.fn() }));
let tree: ReactTestRenderer;
const mount = async (Screen: React.ComponentType) => { await act(async () => { tree = create(<Screen />); }); };
const input = (label: string) => tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label)!;
const fill = (label: string, value: string) => act(() => input(label).props.onChangeText(value));
const select = (label: string, key: string) => act(() => tree.root.findAllByType(ChoiceList).find(node => node.props.label === label)!.props.onSelect(key));
const press = (label: string) => act(() => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!.props.onPress());
const copy = () => tree.root.findAllByType(Text).map(node => node.props.children);
const submit = async () => { await act(async () => tree.root.findByType(SubmitButton).props.onPress()); };
beforeEach(() => { jest.clearAllMocks(); mockCurrent.mockReturnValue(true); jest.spyOn(Alert, 'alert').mockImplementation(() => {}); mockUser = null; mockReadProfile.mockResolvedValue({ data: { first_name_display: 'Maya' } }); mockReadGrants.mockResolvedValue([]); mockSubmit.mockReset().mockResolvedValue('saved-grant'); });
afterEach(() => { if (tree) act(() => tree.unmount()); jest.restoreAllMocks(); });

it.each([[Community, 'Apply for a community'], [Organization, 'Apply for an organization']] as const)('keeps clear invitation copy, review hold and Back for each form', async (Screen, heading) => {
  await mount(Screen); expect(copy()).toContain(heading);
  expect(copy()).toContain('We’ll review new applications when the refreshed Scene is ready.');
  expect(tree.root.findByType(SubmitButton).props.label).toBe('Submit application');
  expect(tree.root.findAllByType(Field).every(node => node.props.appearance.application)).toBe(true);
  press('Back'); expect(mockBack).toHaveBeenCalledTimes(1);
});

it('keeps incomplete submission tappable, reports the displayed field names, and never dispatches', async () => {
  await mount(Community); await submit();
  expect(copy()).toContain('Enter a name for your community.');
  expect(copy()).toContain('Describe what your community will do.');
  expect(copy()).toContain('Add at least one link.');
  expect(mockSubmit).not.toHaveBeenCalled();
});

const completeCommunity = () => {
  fill('Your name', ' Liz '); fill('Community name', ' Sunday Table ');
  fill('What will your community do?', ' Shared meals. '); fill('Who is your community for?', ' Neighbors. ');
  select('How often will you meet?', 'other'); fill('Your planned schedule', ' Twice a month ');
  fill('Tell us about yourself', ' I bring our neighbors together. ');
  fill('Links to your work: link 1', ' https://example.com/community ');
  select('Is this connected to a business, venue, or brand?', 'yes'); fill('Describe the affiliation', ' The local cafe ');
  press('A community is a responsibility');
  act(() => tree.root.findByType(TermsCheck).props.onToggle());
};
it('submits the unchanged Community schema with both acknowledgements and held-review confirmation', async () => {
  await mount(Community); completeCommunity(); await submit();
  expect(mockSubmit).toHaveBeenCalledWith('community_leader', {
    your_name: 'Liz', community_name: 'Sunday Table', concept: 'Shared meals.', audience: 'Neighbors.',
    cadence: 'other', cadence_other: 'Twice a month', why_you: 'I bring our neighbors together.',
    proof_links: ['https://example.com/community'], affiliation: 'yes', affiliation_detail: 'The local cafe', responsibility_ack: true,
  });
  expect(copy()).toContain('Application received');
  expect(copy()).toContain('Application received. Check Apply to Scene for updates.');
  press('Done'); expect(mockBack).toHaveBeenCalledTimes(1);
});

it('retains Community answers after a rejected submission', async () => {
  await mount(Community); completeCommunity(); mockSubmit.mockRejectedValue(Error('Offline')); await submit();
  expect(tree.root.findByType(BrandedAlert).props.title).toBe('That did not go through');
  expect(input('Community name').props.value).toBe(' Sunday Table ');
  expect(tree.root.findByType(TermsCheck).props.checked).toBe(true);
  expect(tree.root.findByType(SubmitButton).props.submitting).toBe(false);
});

const completeOrganization = () => {
  select('Which best describes you?', 'venue'); fill('Your name', ' Anna '); fill('Public name', ' Sunday Studio ');
  act(() => tree.root.findByType(ChipMulti).props.onToggle('art'));
  select('How often do you put on events?', 'monthly'); fill('Links to your work: link 1', ' https://example.com/studio ');
  fill('Venue address', ' 100 Beach Road '); select('How do people get tickets today?', 'other_site');
  fill('Tell us about your events', ' Small art evenings. '); act(() => tree.root.findByType(TermsCheck).props.onToggle());
};
it('preserves conditional Organization fields and optional provider in the existing schema', async () => {
  await mount(Organization); completeOrganization();
  expect(input('Ticketing provider (optional)').props.value).toBe(''); await submit();
  expect(mockSubmit).toHaveBeenCalledWith('event_host', {
    applicant_type: 'venue', your_name: 'Anna', public_name: 'Sunday Studio', event_categories: ['art'], frequency: 'monthly',
    proof_links: ['https://example.com/studio'], venue_address: '100 Beach Road', ticketing_today: 'other_site', about: 'Small art evenings.',
  });
});

it('keeps individual applicants independent of a public name or venue, with all original category keys', async () => {
  await mount(Organization); select('Which best describes you?', 'just_me');
  expect(tree.root.findAllByType(Field).map(node => node.props.label)).not.toContain('Public name');
  expect(tree.root.findAllByType(Field).map(node => node.props.label)).not.toContain('Venue address');
  expect(tree.root.findByType(ChipMulti).props.options.map((option: {key: string}) => option.key)).toEqual(['music','comedy','nightlife','food_drink','art','fitness_outdoors','community','film','markets','other']);
});

it('resumes a withdrawn Community application without accepting creator terms', async () => {
  mockUser = { id: 'member' }; mockReadGrants.mockResolvedValue([{ track: 'community_leader', status: 'withdrawn', application: {
    your_name: 'Saved name', community_name: 'Saved community', concept: 'Saved idea', audience: 'Saved audience',
    cadence: 'monthly', why_you: 'Saved reason', proof_links: ['https://example.com/saved'], affiliation: 'no', responsibility_ack: true,
  } }]);
  await mount(Community);
  expect(input('Community name').props.value).toBe('Saved community');
  expect(tree.root.findByType(TermsCheck).props.checked).toBe(false);
  expect(tree.root.findByType(SubmitButton).props.inactive).toBe(true);
});

it('clears inline Community errors as corrected and accepts a link in any slot', async () => {
  await mount(Community); await submit();
  fill('Your name','Liz'); expect(copy()).not.toContain('Enter your name.');
  expect(copy()).toContain('Enter a name for your community.');
  fill('Links to your work: link 2','https://example.com/second'); expect(copy()).not.toContain('Add at least one link.');
  select('How often will you meet?','other'); expect(copy()).toContain('Enter your planned schedule.');
  fill('Your planned schedule','Once each season'); expect(copy()).not.toContain('Enter your planned schedule.');
  select('Is this connected to a business, venue, or brand?','yes'); expect(copy()).toContain('Describe the affiliation.');
  select('Is this connected to a business, venue, or brand?','no'); expect(copy()).not.toContain('Describe the affiliation.');
  expect(mockSubmit).not.toHaveBeenCalled();
});

it('keeps consent as the first unfinished section without accepting it, then submits the existing valid payload', async () => {
  await mount(Community); completeCommunity(); act(()=>tree.root.findByType(TermsCheck).props.onToggle());
  await submit(); expect(copy()).toContain('Agree to the creator terms to submit.');
  expect(tree.root.findByType(TermsCheck).props.checked).toBe(false); expect(mockSubmit).not.toHaveBeenCalled();
  act(()=>tree.root.findByType(TermsCheck).props.onToggle()); expect(copy()).not.toContain('Agree to the creator terms to submit.');
  await submit(); expect(mockSubmit).toHaveBeenCalledTimes(1);
});

it('reports and clears Organization conditional field errors without requiring optional provider', async () => {
  await mount(Organization); await submit(); expect(copy()).toContain('Choose the option that best describes you.');
  select('Which best describes you?','other'); expect(copy()).toContain('Describe your work.');
  fill('How would you describe your work?','Outdoor experiences'); expect(copy()).not.toContain('Describe your work.');
  select('Which best describes you?','venue'); expect(copy()).toContain('Enter your venue’s address.');
  select('How do people get tickets today?','other_site'); expect(input('Ticketing provider (optional)').props.accessibilityHint).toBeUndefined();
  select('Which best describes you?','just_me'); expect(copy()).not.toContain('Enter your venue’s address.');
});

const exitGuard = () => mockPrevent.mock.calls.at(-1)!;
const attemptBack = () => {
  expect(exitGuard()[0]).toBe(true);
  act(() => exitGuard()[1]({ data: { action: { type: 'GO_BACK' } } }));
  return jest.mocked(Alert.alert).mock.calls.at(-1)![2]!;
};

it.each([[Community, 'Community name'], [Organization, 'Public name']] as const)('protects edited application answers from Back until explicit discard', async (Screen, label) => {
  await mount(Screen);
  if (Screen === Organization) select('Which best describes you?', 'venue');
  fill(label, 'Keep these answers');
  let buttons = attemptBack();
  act(() => buttons.find(button => button.text === 'Keep editing')!.onPress!());
  expect(input(label).props.value).toBe('Keep these answers');
  expect(mockDispatch).not.toHaveBeenCalled();
  buttons = attemptBack();
  act(() => buttons.find(button => button.text === 'Discard changes')!.onPress!());
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  expect(mockSubmit).not.toHaveBeenCalled();
});

it.each([Community, Organization])('does not warn for automatic name prefill or a restored server application', async Screen => {
  mockUser = { id: 'member' };
  mockReadGrants.mockResolvedValue([
    { track: 'community_leader', status: 'withdrawn', application: { community_name: 'Saved community' } },
    { track: 'event_host', status: 'withdrawn', application: { public_name: 'Saved organization' } },
  ]);
  await mount(Screen);
  expect(input('Your name').props.value).toBe('Maya');
  expect(exitGuard()[0]).toBe(false);
});

it('guards choice-only changes and ignores repeated back prompts', async () => {
  await mount(Organization); select('Which best describes you?', 'venue');
  attemptBack(); attemptBack();
  expect(Alert.alert).toHaveBeenCalledTimes(1);
});

it('does not allow a stale discard confirmation to navigate after account retirement', async () => {
  await mount(Community); fill('Community name', 'Private answers');
  const buttons = attemptBack(); mockCurrent.mockReturnValue(false);
  act(() => buttons.find(button => button.text === 'Discard changes')!.onPress!());
  expect(mockDispatch).not.toHaveBeenCalled();
});

it('does not allow discard after the application screen unmounts', async () => {
  await mount(Community); fill('Community name', 'Private answers');
  const buttons = attemptBack(); act(() => tree.unmount());
  act(() => buttons.find(button => button.text === 'Discard changes')!.onPress!());
  expect(mockDispatch).not.toHaveBeenCalled();
});

it('blocks leaving an active submission and releases the guard after success', async () => {
  let finish!: (value: string) => void;
  mockSubmit.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await mount(Community); completeCommunity();
  act(() => tree.root.findByType(SubmitButton).props.onPress());
  const buttons = attemptBack();
  expect(buttons.map(button => button.text)).toEqual(['OK']);
  expect(mockDispatch).not.toHaveBeenCalled();
  act(() => buttons[0].onPress!());
  await act(async () => finish('saved-grant'));
  expect(exitGuard()[0]).toBe(false);
});

it('retains exit protection after failed submission', async () => {
  await mount(Community); completeCommunity(); mockSubmit.mockRejectedValue(Error('Offline')); await submit();
  expect(exitGuard()[0]).toBe(true);
});


it('keeps newly typed and deliberately cleared Community answers when saved answers arrive late', async () => {
  mockUser = { id: 'member' };
  let resolve!: (grants: unknown[]) => void;
  mockReadGrants.mockReturnValue(new Promise(done => { resolve = done; }));
  await mount(Community);
  fill('Community name', 'New community');
  fill('Your name', '');
  select('How often will you meet?', 'weekly');
  fill('Links to your work: link 1', 'https://example.com/new');
  await act(async () => resolve([{ track: 'community_leader', status: 'withdrawn', application: {
    your_name: 'Old name', community_name: 'Old community', cadence: 'monthly',
    concept: 'Restore this untouched answer', proof_links: ['https://example.com/old'],
  } }]));
  expect(input('Community name').props.value).toBe('New community');
  expect(input('Your name').props.value).toBe('');
  expect(input('What will your community do?').props.value).toBe('Restore this untouched answer');
  expect(tree.root.findAllByType(ChoiceList).find(node => node.props.label === 'How often will you meet?')!.props.selected).toBe('weekly');
  expect(input('Links to your work: link 1').props.value).toBe('https://example.com/new');
});

it('keeps Organization choices and category removals when saved answers arrive late', async () => {
  mockUser = { id: 'member' };
  let resolve!: (grants: unknown[]) => void;
  mockReadGrants.mockReturnValue(new Promise(done => { resolve = done; }));
  await mount(Organization);
  select('Which best describes you?', 'just_me');
  act(() => tree.root.findByType(ChipMulti).props.onToggle('art'));
  act(() => tree.root.findByType(ChipMulti).props.onToggle('art'));
  fill('Tell us about your events', 'New event idea');
  await act(async () => resolve([{ track: 'event_host', status: 'needs_more_info', application: {
    applicant_type: 'venue', event_categories: ['music'], about: 'Old idea',
    frequency: 'monthly', proof_links: ['https://example.com/saved'],
  } }]));
  expect(tree.root.findAllByType(ChoiceList).find(node => node.props.label === 'Which best describes you?')!.props.selected).toBe('just_me');
  expect(tree.root.findByType(ChipMulti).props.selected).toEqual([]);
  expect(input('Tell us about your events').props.value).toBe('New event idea');
  expect(input('Links to your work: link 1').props.value).toBe('https://example.com/saved');
  expect(tree.root.findByType(TermsCheck).props.checked).toBe(false);
});


it.each([Community, Organization])('keeps an intentionally empty name when profile prefill arrives late', async Screen => {
  mockUser = { id: 'member' };
  let resolve!: (value: unknown) => void;
  mockReadProfile.mockReturnValue(new Promise(done => { resolve = done; }));
  await mount(Screen); fill('Your name', 'Draft name'); fill('Your name', '');
  await act(async () => resolve({ data: { first_name_display: 'Maya' } }));
  expect(input('Your name').props.value).toBe('');
  expect(mockReadGrants).toHaveBeenCalledWith('member');
});

it.each([Community, Organization])('stops prefill work when its screen unmounts during the profile read', async Screen => {
  mockUser = { id: 'member' };
  let resolve!: (value: unknown) => void;
  mockReadProfile.mockReturnValue(new Promise(done => { resolve = done; }));
  await mount(Screen); act(() => tree.unmount());
  await act(async () => resolve({ data: { first_name_display: 'Maya' } }));
  expect(mockReadGrants).not.toHaveBeenCalled();
});
