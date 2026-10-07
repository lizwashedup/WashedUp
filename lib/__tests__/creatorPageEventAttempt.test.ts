import AsyncStorage from '@react-native-async-storage/async-storage';
const mockUUID = jest.fn(() => 'stable-event');
jest.mock('expo-crypto', () => ({ randomUUID: () => mockUUID() }));
import { prepareCreatorPageEventAttempt, readCreatorPageEventAttempt, clearCreatorPageEventAttempt } from '../creatorPageEventAttempt';
const scope = { userId: 'creator', isCurrent: () => true };
beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); });
it('returns to the same durable event attempt without creating another ID', async () => {
  const a = await prepareCreatorPageEventAttempt('page', ' First event ', 'music', scope);
  await expect(prepareCreatorPageEventAttempt('page', 'Changed text', 'art', scope)).resolves.toEqual(a);
  expect(mockUUID).toHaveBeenCalledTimes(1);
  await expect(readCreatorPageEventAttempt('page', scope)).resolves.toEqual({ pageId: 'page', eventId: 'stable-event', title: 'First event', category: 'music' });
});
it('separates accounts and pages, and clears only a matching receipt', async () => {
  const a = await prepareCreatorPageEventAttempt('page', 'Event', 'music', scope);
  await expect(readCreatorPageEventAttempt('page', { ...scope, userId: 'other' })).resolves.toBeNull();
  await expect(readCreatorPageEventAttempt('different-page', scope)).resolves.toBeNull();
  await clearCreatorPageEventAttempt({ ...a, eventId: 'other' }, scope);
  await expect(readCreatorPageEventAttempt('page', scope)).resolves.toEqual(a);
  await clearCreatorPageEventAttempt(a, scope); await expect(readCreatorPageEventAttempt('page', scope)).resolves.toBeNull();
});
it('storage failure prevents obtaining a dispatchable attempt', async () => {
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(prepareCreatorPageEventAttempt('page', 'Event', 'music', scope)).rejects.toThrow('Storage unavailable');
});
it('retired visits cannot consume or clear recovery state', async () => {
  await prepareCreatorPageEventAttempt('page', 'Event', 'music', scope);
  await expect(readCreatorPageEventAttempt('page', { ...scope, isCurrent: () => false })).rejects.toThrow();
  await expect(readCreatorPageEventAttempt('page', scope)).resolves.not.toBeNull();
});
