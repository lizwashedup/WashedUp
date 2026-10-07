import React from 'react';
jest.mock('../../components/ProfileButton',()=>()=>null);
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockStorage = new Map<string, string>();
const mockPreview = jest.fn(), mockSubmit = jest.fn(), mockStatus = jest.fn();
let mockEnabled = true;
const mockScope = { userId: '11111111-1111-4111-8111-111111111111', isCurrent: () => true };
const mockEvent = '22222222-2222-4222-8222-222222222222';
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: async (k: string) => mockStorage.get(k) ?? null, setItem: async (k: string, v: string) => { mockStorage.set(k, v); }, removeItem: async (k: string) => { mockStorage.delete(k); },
} }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockEvent }), router: { canGoBack: () => true, back: jest.fn() }, Stack: { Screen: () => null } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '33333333-3333-4333-8333-333333333333' }));
jest.mock('../../constants/FeatureFlags', () => ({ get ATTENDEE_MESSAGE_SEND_ENABLED() { return mockEnabled; }, MESSAGE_TEST_SEND_ENABLED: false }));
jest.mock('../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => ({ scope: mockScope, account: { isLoading: false, error: null } }) }));
jest.mock('../../hooks/useCommunicationDraftExit', () => ({ useCommunicationDraftExit: () => undefined }));
jest.mock('../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: { regular: 'System', semibold: 'System', medium: 'System' } }) }));
jest.mock('../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('../../lib/creatorCommunications', () => ({
  getCommunicationEvent: async () => ({ id: mockEvent, title: 'Sunday Table', image: null, venue: 'Los Angeles' }),
  getCommunicationAudienceSources: async () => ({ seats: [], rsvps: 3 }),
}));
jest.mock('../../lib/attendeeMessageSend', () => {
  const contract = jest.requireActual('../../lib/attendeeMessageContract');
  return { messageContent: (d: any) => contract.readMessageContent({ ...d, audience: { ...d.audience, search: '' } }),
    reviewAttendeeMessage: (...a: unknown[]) => mockPreview(...a), submitAttendeeMessage: (...a: unknown[]) => mockSubmit(...a), readAttendeeMessageStatus: (...a: unknown[]) => mockStatus(...a), AttendeeMessageRejected: class extends Error {},
  };
});
import AttendeeMessageScreen from '../creator/attendee-message';
let tree: ReactTestRenderer;
const review = { eventId: mockEvent, recipientCount: 2, reviewHash: 'a'.repeat(64), channel: 'in_app_push', providerDeliveryConfirmed: false };
const receipt = { id: '44444444-4444-4444-8444-444444444444', eventId: mockEvent, requestId: '33333333-3333-4333-8333-333333333333', recipientCount: 2, pushQueuedCount: 2, deliveryStatus: 'queued', createdAt: '2026-09-16T17:00:00Z', providerDeliveryConfirmed: false };
const action = (label: string) => tree.root.findAll(v => v.props.accessibilityLabel === label && typeof v.props.onPress === 'function')[0];
const input = (label: string) => tree.root.findAll(v => v.props.accessibilityLabel === label && typeof v.props.onChangeText === 'function')[0];
const press = async (label: string) => { await act(async () => { action(label).props.onPress(); }); };
const compose = async () => {
  await act(async () => { tree = create(<AttendeeMessageScreen />); });
  await act(async () => { input('Message subject').props.onChangeText('Sunday update'); });
  await act(async () => { input('Your message').props.onChangeText('Meet by the north gate.'); });
};
beforeEach(() => { jest.clearAllMocks(); mockStorage.clear(); mockEnabled = true; mockPreview.mockResolvedValue(review); mockSubmit.mockResolvedValue(receipt); mockStatus.mockResolvedValue(null); });
afterEach(() => { if (tree) act(() => tree.unmount()); });
it('actual composer reviews exact server count, then sends only after explicit confirmation and starts a fresh draft', async () => {
  await compose(); await press('Review update');
  expect(mockPreview).toHaveBeenCalledTimes(1); expect(mockSubmit).not.toHaveBeenCalled();
  expect(tree.root.findAll(v => v.props.children === '2 recipients').length).toBeGreaterThan(0);
  await press('Send update'); expect(mockSubmit).toHaveBeenCalledTimes(1); expect(action('Write another')).toBeTruthy();
  await press('Write another'); expect(input('Message subject').props.value).toBe(''); expect(input('Your message').props.value).toBe('');
});
it('actual lost-response screen checks status and retries the same reviewed request', async () => {
  await compose(); await press('Review update'); mockSubmit.mockRejectedValueOnce(Error('Unknown response'));
  await press('Send update'); expect(action('Check status')).toBeTruthy(); expect(action('Send update')).toBeUndefined();
  await press('Check status'); await press('Retry original');
  expect(mockSubmit.mock.calls[0].slice(0, 4)).toEqual(mockSubmit.mock.calls[1].slice(0, 4)); expect(action('Write another')).toBeTruthy();
});
it('default-off builds retain draft review without recipient dispatch', async () => {
  mockEnabled = false; await compose(); await press('Review draft');
  expect(action('Send update')).toBeUndefined(); expect(mockPreview).not.toHaveBeenCalled(); expect(mockSubmit).not.toHaveBeenCalled();
});
