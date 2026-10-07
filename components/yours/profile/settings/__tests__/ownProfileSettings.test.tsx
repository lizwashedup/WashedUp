import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity, Share, Keyboard } from 'react-native';
import ProfileScreen from '../../../../../app/(tabs)/profile';
import { BrandedAlert } from '../../../../BrandedAlert';
import SettingsPortrait from '../SettingsPortrait';
import { Image } from 'expo-image';
import { deliberateSignOutAt, lastUnauthRedirectAt } from '../../../../../lib/navState';

const mockRead = jest.fn(), mockSave = jest.fn(), mockUser = jest.fn(), mockRefresh = jest.fn(), mockSignOut = jest.fn(), mockRpc = jest.fn(), mockInvoke = jest.fn();
const mockAccess = jest.fn(), mockGrants = jest.fn(), mockOrganizer = jest.fn(), mockSelected = jest.fn();
const mockBack = jest.fn(), mockPush = jest.fn(), mockReplace = jest.fn(), mockInvalidate = jest.fn(), mockForget = jest.fn(), mockRetry = jest.fn();
const mockPermission = jest.fn(), mockCamera = jest.fn(), mockLibrary = jest.fn(), mockManipulate = jest.fn();
const mockDeleteAuthCallbacks = new Set<(event: string, session: any) => void>();
let mockViewer = 'account-a', mockEpoch = 1, mockFocused = true, mockAccountError: Error | null = null, mockOpenEdit: string | undefined;
let mockHandleStatus = 'unchanged', mockIsAdmin = false, mockPagesEnabled = false;
const mockFocusContext = React.createContext(true);
const mockPhoto = { uri: 'edit.jpg', base64: 'jpeg' };
jest.mock('../profileOperations', () => ({
  ...jest.requireActual('../profileOperations'),
  readOwnProfile: (...args: any[]) => mockRead(...args), saveOwnProfile: (...args: any[]) => mockSave(...args),
}));
jest.mock('../useProfileHandleAvailability', () => ({ useProfileHandleAvailability: ({ handle }: any) => ({ handle, status: mockHandleStatus, canSave: ['available', 'unchanged'].includes(mockHandleStatus), retry: mockRetry }) }));
jest.mock('../../../../../lib/supabase', () => ({ supabase: {
  auth: { getUser: (...args: any[]) => mockUser(...args), refreshSession: (...args: any[]) => mockRefresh(...args), signOut: (...args: any[]) => mockSignOut(...args), onAuthStateChange: (callback: any) => { mockDeleteAuthCallbacks.add(callback); return { data: { subscription: { unsubscribe: () => mockDeleteAuthCallbacks.delete(callback) } } }; } },
  rpc: (...args: any[]) => mockRpc(...args), functions: { invoke: (...args: any[]) => mockInvoke(...args) },
} }));
jest.mock('../../../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: jest.fn() }));
jest.mock('../../../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const React = require('react'); const viewerId = mockViewer, epoch = mockEpoch;
  const isCurrent = React.useCallback(() => viewerId === mockViewer && epoch === mockEpoch, [viewerId, epoch]);
  return { viewerId, epoch, isCurrent, isLoading: false, error: mockAccountError, retry: mockRetry };
} }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (callback: any) => {
  const React = require('react'); const focused = React.useContext(mockFocusContext);
  React.useEffect(() => focused ? callback() : undefined, [focused, callback]);
} }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: mockPush, replace: mockReplace }), useLocalSearchParams: () => ({ openEdit: mockOpenEdit }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock('../../../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../../../../constants/FeatureFlags', () => ({ COMMUNITY_CHAT_GROUPING_ENABLED: true, COMMUNITIES_ENABLED: true, get CREATOR_PAGES_ENABLED(){return mockPagesEnabled;} }));
jest.mock('../../../../../constants/Admin', () => ({ isAdmin: () => mockIsAdmin }));
jest.mock('../../../../../lib/creatorMode', () => ({ getCreatorAccess: (...args: any[]) => mockAccess(...args), hasCreatorAccess: (access: any) => !!access && (access.hasEventHostGrant || access.ledCommunities?.length > 0) }));
jest.mock('../../../../../lib/operatorApplications', () => ({ fetchMyGrants: (...args: any[]) => mockGrants(...args) }));
jest.mock('../../../../../lib/organizerProfile', () => ({ getMyOrganizerProfile: (...args: any[]) => mockOrganizer(...args) }));
jest.mock('../../../../../lib/selectedCommunity', () => ({ setSelectedCommunityId: (...args: any[]) => mockSelected(...args) }));
jest.mock('../../../../../lib/knownAccount', () => ({ forgetAccount: (...args: any[]) => mockForget(...args) }));
jest.mock('../../../../../lib/navState', () => ({ deliberateSignOutAt: { ts: 0 }, lastUnauthRedirectAt: { ts: 0 } }));
jest.mock('../../../../../lib/authRouting', () => ({ unauthedRoute: () => '/welcome' }));
jest.mock('../../../../../lib/logger', () => ({ logError: jest.fn() }));
jest.mock('../../../../../lib/contentFilter', () => ({ checkContent: () => ({ ok: true }) }));
jest.mock('../../../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticSelection: jest.fn() }));
jest.mock('../../../../../hooks/usePushNotifications', () => ({ registerPushNotificationsWithResult: jest.fn().mockResolvedValue({ status: 'registered' }) }));
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: (...args: any[]) => mockPermission(...args), requestMediaLibraryPermissionsAsync: (...args: any[]) => mockPermission(...args), launchCameraAsync: (...args: any[]) => mockCamera(...args), launchImageLibraryAsync: (...args: any[]) => mockLibrary(...args) }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: (...args: any[]) => mockManipulate(...args), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('lucide-react-native', () => ({ Camera: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../../../SkeletonCard', () => ({ SkeletonProfile: () => null }));
jest.mock('../../../../BrandedAlert', () => ({ BrandedAlert: () => null }));

const original = { id: 'account-a', first_name: 'Liz', handle: 'liz', avatar_url: 'photo.jpg', bio: 'Private original bio', city: 'Los Angeles', gender: 'woman', neighborhood: 'Pasadena', is_visitor: false, fun_fact: 'Volleyball' };
const saved = { first_name_display: 'Liz', profile_photo_url: 'photo.jpg', handle: 'liz', neighborhood: 'Pasadena', is_visitor: false, fun_fact: 'Volleyball' };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let tree: ReactTestRenderer | undefined;
const screen = () => <mockFocusContext.Provider value={mockFocused}><ProfileScreen/></mockFocusContext.Provider>;
const flush = async () => { await act(async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); }); };
const mount = async () => { act(() => { tree = create(screen()); }); await flush(); };
const update = async () => { act(() => { tree!.update(screen()); }); await flush(); };
const byLabel = (label: string) => tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!;
const button = (label: string) => tree!.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!;
const field = (label: string) => tree!.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label)!;
const text = (value: string) => tree!.root.findAllByType(Text).some(node => node.props.children === value);
const alert = () => tree!.root.findByType(BrandedAlert).props;
const press = async (node: any) => { act(() => { node.props.onPress(); }); await flush(); };
const edit = async () => { await press(byLabel('Edit profile')); };
const change = (label: string, value: string) => act(() => { field(label).props.onChangeText(value); });
async function deleteStep2() { await press(byLabel('Delete account')); await press(byLabel('I understand, continue')); }
beforeEach(() => {
  mockPagesEnabled = false;
  jest.clearAllMocks(); mockDeleteAuthCallbacks.clear(); mockViewer = 'account-a'; mockEpoch = 1; mockFocused = true; mockAccountError = null; mockOpenEdit = undefined; mockHandleStatus = 'unchanged'; mockIsAdmin = false;
  mockRead.mockReset().mockImplementation(async () => ({ ...original, id: mockViewer })); mockSave.mockReset().mockResolvedValue(saved);
  mockUser.mockReset().mockImplementation(async () => ({ data: { user: { id: mockViewer } }, error: null }));
  mockRefresh.mockReset().mockImplementation(async () => ({ data: { session: { user: { id: mockViewer }, access_token: 'local-test-token' } }, error: null }));
  mockSignOut.mockReset().mockResolvedValue({ error: null }); mockRpc.mockReset().mockResolvedValue({ error: null }); mockInvoke.mockReset().mockResolvedValue({ error: null });
  mockAccess.mockReset().mockResolvedValue(null); mockGrants.mockReset().mockResolvedValue([]); mockOrganizer.mockReset().mockResolvedValue(null);
  mockPermission.mockReset().mockResolvedValue({ status: 'granted' }); mockLibrary.mockReset().mockResolvedValue({ canceled: false, assets: [{ uri: 'selected.jpg' }] }); mockCamera.mockReset().mockResolvedValue({ canceled: true }); mockManipulate.mockReset().mockResolvedValue(mockPhoto);
  deliberateSignOutAt.ts = 0; lastUnauthRedirectAt.ts = 0;
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {}); jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.restoreAllMocks(); });

it('shows failed read and explicit retry before exposing profile actions', async () => {
  mockRead.mockRejectedValueOnce(new Error('offline')); await mount(); expect(text('Couldn’t load your profile.')).toBe(true); expect(byLabel('Edit profile')).toBeUndefined();
  await press(byLabel('Try again to load profile')); expect(byLabel('Edit profile')).toBeDefined();
});
it('shows unavailable for an absent profile and stops a read result after account replacement', async () => {
  const pending = deferred<any>(); mockRead.mockReturnValueOnce(pending.promise); await mount(); const oldScope = mockRead.mock.calls[0][0];
  mockViewer = 'account-b'; mockEpoch++; mockRead.mockResolvedValue(null); await update();
  expect(oldScope.isCurrent()).toBe(false); pending.resolve(original); await flush(); expect(text('Your profile isn’t available.')).toBe(true); expect(text('Liz')).toBe(false);
});
it('preserves fields, limits and read-only gender, including an existing Other neighborhood', async () => {
  mockRead.mockResolvedValue({ ...original, neighborhood: 'Out of town' }); await mount(); await edit();
  expect(field('Display name').props.maxLength).toBe(30); expect(field('Handle').props.maxLength).toBe(20); expect(field('Fun fact').props.maxLength).toBe(120); expect(field('Other neighborhood').props.maxLength).toBe(40);
  expect(field('Other neighborhood').props.value).toBe('Out of town'); expect(field('Gender identity')).toBeUndefined(); expect(text('Woman')).toBe(true); expect(field('Bio')).toBeUndefined();
  expect(byLabel('I live in LA').props.accessibilityState.checked).toBe(true); await press(byLabel('I am visiting LA')); expect(byLabel('I am visiting LA').props.accessibilityState.checked).toBe(true);
});
it('normalizes handles and exposes checking/error/taken without enabling Save', async () => {
  await mount(); await edit(); change('Handle', '@NeW.Name'); expect(field('Handle').props.value).toBe('newname');
  mockHandleStatus = 'checking'; await update(); expect(text('Checking handle…')).toBe(true); expect(byLabel('Save changes').props.disabled).toBe(true);
  mockHandleStatus = 'error'; await update(); await press(byLabel('Try again to check handle')); expect(mockRetry).toHaveBeenCalledTimes(1); expect(byLabel('Save changes').props.disabled).toBe(true);
  mockHandleStatus = 'taken'; await update(); expect(text('This handle is taken.')).toBe(true);
});
it('keeps a failed save in the same form and locks two immediate submissions', async () => {
  const pending = deferred<any>(); mockSave.mockReturnValueOnce(pending.promise); await mount(); await edit(); change('Display name', 'Updated Liz');
  const save = byLabel('Save changes'); act(() => { save.props.onPress(); save.props.onPress(); }); await flush(); expect(mockSave).toHaveBeenCalledTimes(1); expect(field('Display name').props.editable).toBe(false);
  expect(mockSave.mock.calls[0][0]).toEqual({ name: 'Updated Liz', handle: 'liz', neighborhood: 'Pasadena', isVisitor: false, funFact: 'Volleyball', photoUrl: 'photo.jpg', photoBase64: null });
  pending.reject(new Error('offline')); await flush(); expect(alert().title).toBe('Could not save'); expect(alert().message).toBe('Your changes are still here. Try saving again.'); expect(field('Display name').props.value).toBe('Updated Liz');
  act(() => alert().onClose()); await press(byLabel('Save changes')); expect(mockSave).toHaveBeenCalledTimes(2); expect(byLabel('Edit profile')).toBeDefined(); expect(mockInvalidate).toHaveBeenCalledTimes(1);
});
it('keeps explicit edit exits locked until an in-flight save settles', async () => {
  const pending = deferred<any>(); mockSave.mockReturnValueOnce(pending.promise); await mount(); await edit(); await press(byLabel('Save changes'));
  expect(byLabel('Back from profile editing').props.disabled).toBe(true); expect(button('Cancel').props.disabled).toBe(true); await press(byLabel('Back from profile editing'));
  expect(field('Display name')).toBeDefined(); pending.resolve({ ...saved, first_name_display: 'Confirmed Liz' }); await flush(); expect(text('Confirmed Liz')).toBe(true); await edit(); expect(field('Display name').props.value).toBe('Confirmed Liz');
});
it('retires an edit across same-account generation changes and after blur', async () => {
  const pending = deferred<any>(); mockSave.mockReturnValueOnce(pending.promise); await mount(); await edit(); await press(byLabel('Save changes')); const scope = mockSave.mock.calls[0][1];
  mockFocused = false; await update(); expect(scope.isCurrent()).toBe(false); mockEpoch++; mockFocused = true; await update(); pending.resolve(saved); await flush(); expect(mockInvalidate).not.toHaveBeenCalled(); expect(byLabel('Edit profile')).toBeDefined();
});
it('refreshes the current same-account profile after an old visit save settles, bypassing the focus throttle', async () => {
  const pending = deferred<any>(); mockSave.mockReturnValueOnce(pending.promise); await mount(); await edit(); await press(byLabel('Save changes'));
  mockFocused = false; await update(); mockFocused = true; await update();
  expect(byLabel('Saving profile').props.disabled).toBe(true);
  const readsBeforeReceipt = mockRead.mock.calls.length; mockRead.mockResolvedValue({ ...original, first_name: 'Confirmed after return' });
  pending.resolve({ ...saved, first_name_display: 'Confirmed after return' }); await flush();
  expect(mockRead.mock.calls.length).toBeGreaterThan(readsBeforeReceipt); expect(mockInvalidate).not.toHaveBeenCalled();
  await press(byLabel('Back from profile editing')); expect(text('Confirmed after return')).toBe(true); await edit(); expect(field('Display name').props.value).toBe('Confirmed after return');
});
it('replaces an in-flight refocus read when a retired save settles instead of accepting its pre-save snapshot', async () => {
  const saving = deferred<any>(); mockSave.mockReturnValueOnce(saving.promise); await mount(); await edit(); await press(byLabel('Save changes'));
  const oldRead = deferred<any>(); mockRead.mockReturnValueOnce(oldRead.promise); mockFocused = false; await update(); mockFocused = true; await update();
  const oldReadScope = mockRead.mock.calls[mockRead.mock.calls.length - 1][0]; expect(oldReadScope.isCurrent()).toBe(true);
  const freshRead = deferred<any>(); mockRead.mockReturnValueOnce(freshRead.promise); saving.resolve({ ...saved, first_name_display: 'Newest confirmed profile' }); await flush();
  expect(oldReadScope.isCurrent()).toBe(false); oldRead.resolve(original); await flush(); expect(byLabel('Saving profile').props.disabled).toBe(true);
  freshRead.resolve({ ...original, first_name: 'Newest confirmed profile' }); await flush();
  await press(byLabel('Back from profile editing')); expect(text('Newest confirmed profile')).toBe(true); await edit(); expect(field('Display name').props.value).toBe('Newest confirmed profile');
});
it('consumes openEdit once so cancel stays closed and a later read does not reset a draft', async () => {
  mockOpenEdit = 'true'; await mount(); expect(field('Display name')).toBeDefined(); await press(button('Cancel')); await update(); expect(byLabel('Edit profile')).toBeDefined();
  await edit(); change('Display name', 'Kept draft'); mockFocused = false; await update(); mockFocused = true; await update(); expect(field('Display name').props.value).toBe('Kept draft');
});
it('retains image selection/crop/format and carries only prepared photo bytes into Save', async () => {
  await mount(); await edit(); await press(byLabel('Change photo'));
  const info = alert(); act(() => { info.buttons.find((item: any) => item.text === 'Choose from Library').onPress(); info.onClose(); }); await flush();
  expect(mockLibrary).toHaveBeenCalledWith({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  expect(mockManipulate).toHaveBeenCalledWith('selected.jpg', [{ resize: { width: 800, height: 800 } }], { compress: 0.85, format: 'jpeg', base64: true });
  await press(byLabel('Save changes')); expect(mockSave.mock.calls[0][0].photoBase64).toBe('jpeg');
});
it('does not launch a native picker when permission arrives after closing the edit', async () => {
  const pending = deferred<any>(); mockPermission.mockReturnValue(pending.promise); await mount(); await edit(); await press(byLabel('Change photo'));
  act(() => alert().buttons[0].onPress()); await flush(); await press(byLabel('Back from profile editing')); pending.resolve({ status: 'granted' }); await flush(); expect(mockCamera).not.toHaveBeenCalled();
});
it('reports denied permission and invalid photo without replacing the existing image', async () => {
  mockPermission.mockResolvedValueOnce({ status: 'denied' }); await mount(); await edit(); await press(byLabel('Change photo')); act(() => alert().buttons[0].onPress()); await flush(); expect(alert().title).toBe('Permission needed');
  act(() => alert().onClose()); mockManipulate.mockRejectedValueOnce(new Error('bad image')); await press(byLabel('Change photo')); act(() => alert().buttons[1].onPress()); await flush(); expect(alert().title).toBe('Invalid image');
  expect(tree!.root.findByType(SettingsPortrait).props.uri).toBe('photo.jpg');
});
it('falls back to the real name initial for a broken portrait and isolates errors from an older photo', async () => {
  await mount(); const oldPhoto = tree!.root.findByType(Image).props;
  act(() => oldPhoto.onError()); expect(text('L')).toBe(true);
  await edit(); await press(byLabel('Change photo')); const info = alert(); act(() => { info.buttons[1].onPress(); info.onClose(); }); await flush();
  expect(tree!.root.findByType(Image).props.source.uri).toBe('edit.jpg'); act(() => oldPhoto.onError()); expect(tree!.root.findByType(Image).props.source.uri).toBe('edit.jpg');
});
it('uses the existing native handle share and ticket destination', async () => {
  await mount(); await press(byLabel('Share your handle')); expect(Share.share).toHaveBeenCalledWith({ message: '@liz' }); await press(button('your tickets')); expect(mockPush).toHaveBeenCalledWith('/tickets');
});
it('keeps approved organization access when grants and its optional name fail', async () => {
  mockAccess.mockResolvedValue({ hasEventHostGrant: true, ledCommunities: [] }); mockGrants.mockRejectedValue(new Error('grants offline')); mockOrganizer.mockRejectedValue(new Error('name offline'));
  await mount(); expect(text('Some creator details couldn’t load.')).toBe(true); expect(button('switch to your events')).toBeDefined(); await press(button('switch to your events')); expect(mockReplace).toHaveBeenCalledWith('/(creator)/organizer-home');
});
it('keeps successful pending grants when access fails, and clears only recovered failure on retry', async () => {
  mockAccess.mockRejectedValueOnce(new Error('offline')); mockGrants.mockResolvedValue([{ id: 'grant', track: 'event_host', status: 'needs_more_info' }]); await mount(); expect(text('needs more info')).toBe(true); expect(button('putting on events')).toBeDefined();
  await press(byLabel('Try again to load creator spaces')); expect(text('Some creator details couldn’t load.')).toBe(false); expect(button('putting on events')).toBeDefined();
});
it('preserves one selected community route and blocks a delayed old row after leaving', async () => {
  mockAccess.mockResolvedValue({ ledCommunities: [{ id: 'club', name: 'Sunset Club', status: 'active' }], hasEventHostGrant: false }); await mount(); const row = button('switch to sunset club & your events');
  await press(row); expect(mockSelected).toHaveBeenCalledWith('club'); expect(mockReplace).toHaveBeenCalledWith('/(creator)/today'); await press(row); expect(mockReplace).toHaveBeenCalledTimes(1);
});
it('preserves both delete stages and the typed confirmation gate', async () => {
  await mount(); await press(byLabel('Delete account')); expect(text('Are you sure?')).toBe(true); expect(field('Type DELETE to confirm')).toBeUndefined();
  await press(byLabel('I understand, continue')); expect(byLabel('Permanently delete account').props.disabled).toBe(true); change('Type DELETE to confirm', 'no'); await press(byLabel('Permanently delete account')); expect(mockRpc).not.toHaveBeenCalled();
  change('Type DELETE to confirm', ' DELETE '); expect(byLabel('Permanently delete account').props.disabled).toBe(false);
});
it('locks confirmed deletion and retains original RPC, fallback, stamps and redirect', async () => {
  const pending = deferred<any>(); mockRpc.mockReturnValueOnce(pending.promise); await mount(); await deleteStep2(); change('Type DELETE to confirm', 'DELETE');
  const confirm = byLabel('Permanently delete account'); act(() => { confirm.props.onPress(); confirm.props.onPress(); }); await flush(); expect(mockRpc).toHaveBeenCalledTimes(1); expect(mockRpc).toHaveBeenCalledWith('delete_own_account'); expect(field('Type DELETE to confirm').props.editable).toBe(false);
  pending.resolve({ error: null }); await flush(); expect(mockInvoke).toHaveBeenCalledWith('delete-user', { headers: { Authorization: 'Bearer local-test-token' } }); expect(mockReplace).toHaveBeenCalledWith('/welcome'); expect(mockForget).toHaveBeenCalledTimes(1); expect(mockSignOut).toHaveBeenCalledTimes(1); expect(deliberateSignOutAt.ts).toBeGreaterThan(0); expect(lastUnauthRedirectAt.ts).toBeGreaterThan(0);
});
it('does not dispatch deletion after a blurred account preflight', async () => {
  await mount(); await deleteStep2(); change('Type DELETE to confirm', 'DELETE'); const pending = deferred<any>(); mockUser.mockReturnValueOnce(pending.promise); await press(byLabel('Permanently delete account'));
  mockFocused = false; await update(); pending.resolve({ data: { user: { id: 'account-a' } }, error: null }); await flush(); expect(mockRefresh).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
});
it('does not fallback or sign out a replacement account after the deletion RPC returns late', async () => {
  const pending = deferred<any>(); mockRpc.mockReturnValueOnce(pending.promise); await mount(); await deleteStep2(); change('Type DELETE to confirm', 'DELETE'); await press(byLabel('Permanently delete account'));
  mockViewer = 'account-b'; mockEpoch++; mockDeleteAuthCallbacks.forEach(callback => callback('SIGNED_IN', { user: { id: 'account-b' } })); await update(); pending.resolve({ error: null }); await flush(); expect(mockInvoke).not.toHaveBeenCalled(); expect(mockSignOut).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled(); expect(mockDeleteAuthCallbacks.size).toBe(0);
});
it('keeps deletion exits locked and completes confirmed cleanup after the screen unmounts', async () => {
  const pending = deferred<any>(); mockRpc.mockReturnValueOnce(pending.promise); await mount(); await deleteStep2(); change('Type DELETE to confirm', 'DELETE'); await press(byLabel('Permanently delete account'));
  expect(byLabel('Back from account deletion').props.disabled).toBe(true); await press(byLabel('Back from account deletion')); expect(field('Type DELETE to confirm')).toBeDefined();
  act(() => tree!.unmount()); tree = undefined; pending.resolve({ error: null }); await flush();
  expect(mockInvoke).toHaveBeenCalledTimes(1); expect(mockForget).toHaveBeenCalledTimes(1); expect(mockReplace).toHaveBeenCalledWith('/welcome'); expect(mockSignOut).toHaveBeenCalledTimes(1); expect(mockDeleteAuthCallbacks.size).toBe(0);
});
it('continues original-account cleanup after deletion signs it out', async () => {
  const pending = deferred<any>(); mockRpc.mockReturnValueOnce(pending.promise); await mount(); await deleteStep2(); change('Type DELETE to confirm', 'DELETE'); await press(byLabel('Permanently delete account'));
  mockDeleteAuthCallbacks.forEach(callback => callback('SIGNED_OUT', null));
  pending.resolve({ error: null }); await flush(); expect(mockSignOut).toHaveBeenCalledTimes(1); expect(mockDeleteAuthCallbacks.size).toBe(0);
});
it('retires deletion cleanup permanently after an original-account sign-out/sign-in ABA', async () => {
  const pending = deferred<any>(); mockRpc.mockReturnValueOnce(pending.promise); await mount(); await deleteStep2(); change('Type DELETE to confirm', 'DELETE'); await press(byLabel('Permanently delete account'));
  mockDeleteAuthCallbacks.forEach(callback => { callback('SIGNED_OUT', null); callback('SIGNED_IN', { user: { id: 'account-a' } }); });
  pending.resolve({ error: null }); await flush(); expect(mockInvoke).not.toHaveBeenCalled(); expect(mockForget).not.toHaveBeenCalled(); expect(mockSignOut).not.toHaveBeenCalled(); expect(mockDeleteAuthCallbacks.size).toBe(0);
});
it('does not navigate or sign out a new account that arrives during the original-token fallback', async () => {
  const pending = deferred<any>(); mockInvoke.mockReturnValueOnce(pending.promise); await mount(); await deleteStep2(); change('Type DELETE to confirm', 'DELETE'); await press(byLabel('Permanently delete account'));
  mockDeleteAuthCallbacks.forEach(callback => callback('SIGNED_IN', { user: { id: 'account-b' } })); pending.resolve({ error: null }); await flush();
  expect(mockForget).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled(); expect(mockSignOut).not.toHaveBeenCalled(); expect(mockDeleteAuthCallbacks.size).toBe(0);
});
it('preserves a rejected server deletion without running fallback or signout and releases its observer', async () => {
  mockRpc.mockResolvedValue({ error: new Error('Pending payout') }); await mount(); await deleteStep2(); change('Type DELETE to confirm', 'DELETE'); await press(byLabel('Permanently delete account'));
  expect(alert().title).toBe('Something went wrong'); expect(mockInvoke).not.toHaveBeenCalled(); expect(mockForget).not.toHaveBeenCalled(); expect(mockSignOut).not.toHaveBeenCalled(); expect(mockDeleteAuthCallbacks.size).toBe(0); expect(byLabel('Back from account deletion').props.disabled).toBe(false);
});
it('retires a logout confirmation after account replacement and retains the current confirmed flow', async () => {
  await mount(); await press(byLabel('Log out')); const oldConfirm = alert().buttons[1].onPress;
  mockViewer = 'account-b'; mockEpoch++; await update(); act(() => oldConfirm()); await flush(); expect(mockSignOut).not.toHaveBeenCalled();
  await press(byLabel('Log out')); const info = alert(); act(() => { info.buttons[1].onPress(); info.buttons[1].onPress(); info.onClose(); }); await flush(); expect(mockForget).toHaveBeenCalledTimes(1); expect(mockSignOut).toHaveBeenCalledTimes(1); expect(deliberateSignOutAt.ts).toBeGreaterThan(0);
});

it('opens contextual Creator space from profile without replacing the personal navigation', async () => {
  mockPagesEnabled = true;
  await mount();
  await press(button('Creator space'));
  expect(mockPush).toHaveBeenCalledWith('/creator/pages');
  expect(mockReplace).not.toHaveBeenCalled();
  expect(mockSelected).not.toHaveBeenCalled();
});
