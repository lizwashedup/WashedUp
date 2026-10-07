import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import WaitlistManagerScreen from '../[id]';
let mockManager: any;
const mockGrant = jest.fn(), mockClosed = jest.fn(), mockRetry = jest.fn();
jest.mock('../../../hooks/useCreatorWaitlist', () => ({ useCreatorWaitlist: () => mockManager }));
jest.mock('../../../hooks/useObservedUser', () => ({ useObservedUser: () => ({ viewerId: 'creator', epoch: 1, isLoading: false, isCurrent: () => true }) }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFonts }) }));
jest.mock('../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'plan' }), router: { canGoBack: () => false, replace: jest.fn(), push: jest.fn() } }));
jest.mock('expo-image', () => ({ Image: 'SampleImage' }));
const row = { kind: 'waitlist', user_id: 'next', first_name: 'Amelia', photo: null, queue_position: 1, total: 2, exception_status: 'waiting', context: null };
let tree: ReturnType<typeof create>;
function mount() { act(() => { tree = create(<WaitlistManagerScreen />); }); return tree.root; }
const text = () => tree.root.findAllByType(Text).map(n => n.props.children).flat(Infinity).join(' ');
const button = (name: string) => tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === name)!;
beforeEach(() => { jest.clearAllMocks(); mockManager = { data: { rows: [row, { ...row, user_id: 'later', first_name: 'HiddenName', photo: 'hidden-photo', queue_position: 2 }], slotsUsed: 1, closed: false, ended: false }, error: null, accessError: false, loading: false, busy: false, attempt: null, canAct: true, grant: mockGrant, setClosed: mockClosed, retry: mockRetry, refresh: jest.fn() }; });
afterEach(() => { if (tree)
    act(() => tree.unmount()); });
it('reveals only the eligible person and never requests a masked photo', () => { const root = mount(); expect(text()).toContain('Amelia'); expect(text()).not.toContain('HiddenName'); expect(root.findAll(n => n.props.source?.uri === 'hidden-photo')).toHaveLength(0); act(() => button('Save Amelia a spot in the plan').props.onPress()); expect(mockGrant).toHaveBeenCalledWith('next'); });
it.each([{ slotsUsed: 3 }, { closed: true }, { ended: true }])('disables grants for unavailable state %p', data => { Object.assign(mockManager.data, data); if (data.ended)
    mockManager.canAct = false; mount(); expect(button('Save Amelia a spot in the plan').props.disabled).toBe(true); });
it('describes pausing extra invitations without closing queue admission', () => { mount(); expect(text()).toContain('People can still join the waitlist.'); act(() => button('Pause extra invitations').props.onPress()); expect(mockClosed).toHaveBeenCalledWith(true); });
it('exposes a read-only check after an uncertain action and disables new actions', () => { mockManager.attempt = { action: { kind: 'grant', userId: 'next' }, phase: 'unknown' }; mockManager.error = 'This change may have saved.'; mockManager.canAct = false; mount(); expect(text()).toContain('Check waitlist'); expect(button('Save Amelia a spot in the plan').props.disabled).toBe(true); expect(button('Pause extra invitations').props.disabled).toBe(true); });
it('keeps read failures distinct from an empty queue', () => { mockManager.data = null; mockManager.error = 'Couldn’t refresh the waitlist.'; mockManager.canAct = false; mount(); expect(text()).toContain('Try again'); expect(text()).not.toContain("No one's waiting yet."); });
