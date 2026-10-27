import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import ResetPasswordScreen from '../reset-password';
import { BrandedAlert } from '../../components/BrandedAlert';
const mockUpdate = jest.fn(), mockSignOut = jest.fn(), mockReplace = jest.fn();
let mockViewer: string | null = 'person-a', mockEpoch = 1, mockFocused = true, mockLoading = false;
const mockFocusContext = React.createContext(true);
jest.mock('../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const React = require('react'); const id = mockViewer, epoch = mockEpoch;
  const isCurrent = React.useCallback(() => mockViewer === id && mockEpoch === epoch, [id, epoch]);
  return { viewerId: id, epoch, isCurrent, isLoading: mockLoading, error: null };
} }));
jest.mock('../../lib/supabase', () => ({ supabase: { auth: {
  updateUser: (...a: any[]) => mockUpdate(...a), signOut: (...a: any[]) => mockSignOut(...a),
} } }));
jest.mock('expo-router', () => ({ router: { replace: (...a: any[]) => mockReplace(...a) }, useFocusEffect: (callback: any) => {
  const React = require('react'); const focused = React.useContext(mockFocusContext);
  React.useEffect(() => focused ? callback() : undefined, [focused, callback]);
} }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('../../components/BrandedAlert', () => ({ BrandedAlert: () => null }));
let tree: ReactTestRenderer | undefined;
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
const action = () => tree!.root.findAllByType(TouchableOpacity).find(n => ['Update password', 'Sign in'].includes(n.props.accessibilityLabel))!;
const fields = () => tree!.root.findAllByType(TextInput);
const alert = () => tree!.root.findByType(BrandedAlert).props;
const text = (part: string) => tree!.root.findAllByType(Text).some(n => String(n.props.children).includes(part));
const flush = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
const screen = () => <mockFocusContext.Provider value={mockFocused}><ResetPasswordScreen /></mockFocusContext.Provider>;
const redraw = async () => { act(() => tree!.update(screen())); await flush(); };
const fill = () => act(() => { for (const field of fields()) field.props.onChangeText('fictional-test-only'); });
const submit = async () => { await act(async () => { await action().props.onPress(); }); };
const chooseExit = async () => { act(() => { alert().buttons[0].onPress(); alert().onClose(); }); await flush(); };
const dismiss = async () => { act(() => alert().onDismiss()); await flush(); };
beforeEach(async () => {
  jest.clearAllMocks(); mockViewer = 'person-a'; mockEpoch = 1; mockFocused = true; mockLoading = false;
  mockUpdate.mockReset().mockResolvedValue({ error: null }); mockSignOut.mockReset().mockResolvedValue({ error: null });
  await act(async () => { tree = create(screen()); }); fill();
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; });
it('dispatches one update for rapid button and keyboard submit', async () => {
  const p = deferred(); mockUpdate.mockReturnValue(p.promise);
  act(() => { action().props.onPress(); fields()[1].props.onSubmitEditing(); }); await flush();
  expect(mockUpdate).toHaveBeenCalledTimes(1); expect(action().props.disabled).toBe(true);
  p.resolve({ error: null }); await flush();
});
it.each(['returned', 'thrown'])('retains a draft and retry after a %s failure', async kind => {
  if (kind === 'returned') mockUpdate.mockResolvedValueOnce({ error: new Error('network unavailable') });
  else mockUpdate.mockRejectedValueOnce(new Error('network unavailable'));
  await submit(); expect(action().props.disabled).toBe(false); expect(text('Please try again')).toBe(true);
  expect(fields()[0].props.value).toBe('fictional-test-only'); await submit(); expect(mockUpdate).toHaveBeenCalledTimes(2); expect(alert().visible).toBe(true);
});
it('clears password values after confirmation and does not submit again', async () => {
  const oldSubmit = action().props.onPress; await submit();
  expect(fields()).toHaveLength(0); expect(text('Password updated')).toBe(true); expect(text('Sign in again with your new password.')).toBe(true); expect(JSON.stringify(tree!.toJSON())).not.toContain('fictional-test-only');
  await act(async () => { await oldSubmit(); }); expect(mockUpdate).toHaveBeenCalledTimes(1);
});
it('signs out only once after the iOS confirmation has dismissed', async () => {
  await submit(); const callback = alert().buttons[0].onPress;
  act(() => { callback(); callback(); alert().onClose(); }); await flush();
  expect(mockSignOut).not.toHaveBeenCalled(); await dismiss(); await dismiss();
  expect(mockSignOut).toHaveBeenCalledTimes(1); expect(mockReplace).not.toHaveBeenCalled();
});
it('outside dismissal leaves a sign-in action and does not sign out automatically', async () => {
  await submit(); act(() => alert().onClose()); await dismiss(); expect(mockSignOut).not.toHaveBeenCalled();
  await submit(); expect(mockSignOut).toHaveBeenCalledTimes(1);
});
it('keeps confirmed password success when signing out fails and allows retry', async () => {
  mockSignOut.mockRejectedValueOnce(new Error('offline')); await submit(); await chooseExit(); await dismiss();
  expect(text('password was saved')).toBe(true); expect(action().props.accessibilityLabel).toBe('Sign in');
  await submit(); expect(mockSignOut).toHaveBeenCalledTimes(2); expect(mockUpdate).toHaveBeenCalledTimes(1);
});
it('retires retained confirmation on unmount', async () => {
  await submit(); const callback = alert().buttons[0].onPress, onDismiss = alert().onDismiss;
  act(() => { tree!.unmount(); tree = undefined; }); act(() => { callback(); onDismiss(); }); await flush(); expect(mockSignOut).not.toHaveBeenCalled();
});
it('retires confirmation on blur and rejects its old dismissal after refocus', async () => {
  await submit(); const callback = alert().buttons[0].onPress, oldDismiss = alert().onDismiss;
  mockFocused = false; await redraw(); mockFocused = true; await redraw();
  act(() => { callback(); oldDismiss(); }); await flush(); expect(mockSignOut).not.toHaveBeenCalled();
});
it('does not show a late success after leaving', async () => {
  const p = deferred(); mockUpdate.mockReturnValue(p.promise); act(() => { action().props.onPress(); });
  mockFocused = false; await redraw(); p.resolve({ error: null }); await flush(); expect(alert().visible).toBe(false); expect(mockSignOut).not.toHaveBeenCalled();
});
it('keeps the write lock across refocus until the old request settles', async () => {
  const p = deferred(); mockUpdate.mockReturnValueOnce(p.promise); act(() => { action().props.onPress(); });
  mockFocused = false; await redraw(); mockFocused = true; await redraw(); fill();
  act(() => { action().props.onPress(); }); await flush(); expect(mockUpdate).toHaveBeenCalledTimes(1); expect(action().props.disabled).toBe(true);
  p.resolve({ error: null }); await flush(); expect(action().props.disabled).toBe(false); expect(alert().visible).toBe(false);
});
it('retires success before a replacement account can be signed out', async () => {
  await submit(); const callback = alert().buttons[0].onPress, oldDismiss = alert().onDismiss;
  mockViewer = 'person-b'; mockEpoch++; act(() => { callback(); oldDismiss(); }); await flush();
  expect(mockSignOut).not.toHaveBeenCalled(); await redraw(); expect(action().props.disabled).toBe(true); expect(fields()[0].props.value).toBe('');
});
it('does not update while identity is unresolved or signed out', async () => {
  mockLoading = true; await redraw(); await submit(); expect(mockUpdate).not.toHaveBeenCalled();
  mockLoading = false; mockViewer = null; mockEpoch++; await redraw(); await submit(); expect(mockUpdate).not.toHaveBeenCalled();
});
it('retains validation for short or mismatched values', async () => {
  act(() => fields()[0].props.onChangeText('short')); await submit(); expect(text('at least 8')).toBe(true);
  act(() => fields()[0].props.onChangeText('different-long-value')); await submit(); expect(text('do not match')).toBe(true); expect(mockUpdate).not.toHaveBeenCalled();
});
it('finishes Android exit after the hidden modal state commits', async () => {
  const os = Platform.OS; Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  try { await submit(); await chooseExit(); expect(mockSignOut).toHaveBeenCalledTimes(1); }
  finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: os }); }
});

it('does not submit an old password callback after refocus', async () => {
  const oldSubmit = action().props.onPress;
  mockFocused = false; await redraw(); mockFocused = true; await redraw();
  await act(async () => { await oldSubmit(); }); expect(mockUpdate).not.toHaveBeenCalled();
});
it('does not run a retained sign-in button against a later successful visit', async () => {
  await submit(); act(() => alert().onClose()); await dismiss(); const oldExit = action().props.onPress;
  mockFocused = false; await redraw(); mockFocused = true; await redraw(); fill(); await submit();
  act(() => { oldExit(); }); await dismiss(); expect(mockSignOut).not.toHaveBeenCalled();
});
