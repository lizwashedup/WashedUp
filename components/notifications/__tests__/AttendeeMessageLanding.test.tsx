// Profile header owns its query provider; this suite exercises the surrounding journey.
jest.mock('../../ProfileButton', () => ({ __esModule: true, default: () => null }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockLoad = jest.fn(), mockRead = jest.fn(), mockReplace = jest.fn();
let mockActive = true;
let mockScope: any;
let mockAccount: any;
jest.mock('expo-router', () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args), canGoBack: () => false }, Stack: { Screen: () => null } }));
jest.mock('../../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => ({ scope: mockScope, account: mockAccount }) }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: { regular: 'System', semibold: 'System', medium: 'System' } }) }));
jest.mock('../../../lib/attendeeMessageNotification', () => ({
  loadAttendeeMessageNotice: (...args: unknown[]) => mockLoad(...args),
  markAttendeeMessageRead: (...args: unknown[]) => mockRead(...args),
  attendeeMessageEventRoute: (id: string) => `/event/${id}`,
}));
jest.mock('../EventMessagePreference', () => ({ EventMessagePreference: () => null }));
import { AttendeeMessageLanding } from '../AttendeeMessageLanding';
let tree: ReactTestRenderer;
const notice = { id: 'notice', eventId: 'event', title: 'A new meeting point', body: 'Please meet by the east gate.\nBring your ticket.\nSee you soon!', createdAt: '2026-09-16T17:00:00Z' };
const render = (id = 'notice') => <AttendeeMessageLanding notificationId={id} eventId="event" />;
const press = (label: string) => tree.root.findAll(v => v.props.accessibilityLabel === label && typeof v.props.onPress === 'function')[0].props.onPress();
const has = (label: string) => tree.root.findAll(v => v.props.accessibilityLabel === label).length > 0;
const shows = (text: string) => tree.root.findAll(v => v.props.children === text).length > 0;
beforeEach(() => {
  jest.clearAllMocks(); mockActive = true;
  mockScope = { userId: 'member', isCurrent: () => mockActive };
  mockAccount = { isLoading: false, error: null, retry: jest.fn() };
  mockLoad.mockResolvedValue(notice); mockRead.mockResolvedValue(undefined);
});
afterEach(() => { if (tree) act(() => tree.unmount()); });
it('reads the original full update before opening the exact event once', async () => {
  await act(async () => { tree = create(render()); });
  expect(mockLoad).toHaveBeenCalledWith('notice', 'event', mockScope);
  expect(shows(notice.body)).toBe(true);
  expect(mockRead).toHaveBeenCalledWith('notice', mockScope);
  act(() => { press('Open event'); press('Open event'); });
  expect(mockReplace.mock.calls).toEqual([['/event/event']]);
});
it('keeps full text available when the event no longer exists', async () => {
  mockLoad.mockResolvedValue({ ...notice, eventId: null });
  await act(async () => { tree = create(render()); });
  expect(shows(notice.body)).toBe(true); expect(has('Open event')).toBe(false);
  act(() => press('Back to Scene')); expect(mockReplace).toHaveBeenCalledWith('/(tabs)/explore');
});
it('recovers a failed message read without marking it read or guessing its event', async () => {
  mockLoad.mockRejectedValueOnce(Error('Offline'));
  await act(async () => { tree = create(render()); });
  expect(has('Open event')).toBe(false); expect(mockRead).not.toHaveBeenCalled();
  await act(async () => press('Try again'));
  expect(shows(notice.body)).toBe(true); expect(has('Open event')).toBe(true);
});
it('a missing update is distinct from a failed read', async () => {
  mockLoad.mockResolvedValue(null);
  await act(async () => { tree = create(render()); });
  expect(shows('This update is no longer available for this account.')).toBe(true);
  expect(has('Try again')).toBe(false); expect(has('Open event')).toBe(false); expect(mockRead).not.toHaveBeenCalled();
});
it('optional read bookkeeping cannot block readable content or event navigation', async () => {
  mockRead.mockRejectedValue(Error('Offline'));
  await act(async () => { tree = create(render()); });
  expect(shows(notice.body)).toBe(true); act(() => press('Open event'));
  expect(mockReplace).toHaveBeenCalledWith('/event/event');
});
it('retires a late message after sign-out without exposing or marking it', async () => {
  let resolve: any; mockLoad.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => { tree = create(render()); });
  mockActive = false; mockScope = null;
  await act(async () => { tree.update(render()); resolve(notice); });
  expect(shows(notice.body)).toBe(false); expect(mockRead).not.toHaveBeenCalled(); expect(has('Open event')).toBe(false);
});
it('removes previously visible private content immediately when the account changes', async () => {
  await act(async () => { tree = create(render()); });
  mockActive = false; mockScope = null;
  await act(async () => tree.update(render()));
  expect(shows(notice.body)).toBe(false); expect(has('Open event')).toBe(false);
});
