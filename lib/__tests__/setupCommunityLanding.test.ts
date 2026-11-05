import { act } from 'react-test-renderer';
import {
  resetSetup, cleanupSetup, mountSetup, fillAndCreate, press, action, deferred,
  retireSetup, mockCreate, mockFinish, mockInvalidate, mockSelect, mockWorkspace,
  mockDismissTo, mockPush, mockReplace, savedAttempt,
} from '../../app/creator/__tests__/setupCommunityHarness';

// AC-CRT-002: exercise the real setup screen's handoff, including pending results.
// Navigation must follow verified creation and exact identity selection.
beforeEach(resetSetup);
afterEach(cleanupSetup);

it('refreshes creator access only after confirmed creation and before the chosen destination', async () => {
  const creation = deferred<{ id: string; attempt: typeof savedAttempt }>();
  mockCreate.mockReturnValue(creation.promise);
  await mountSetup(); await fillAndCreate();
  expect(mockInvalidate).not.toHaveBeenCalled(); expect(mockSelect).not.toHaveBeenCalled();
  expect(mockDismissTo).not.toHaveBeenCalled(); expect(action('View community')).toBeUndefined();
  await act(async () => creation.resolve({ id: 'new-community-id', attempt: savedAttempt }));
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['creator-access'] });
  expect(mockDismissTo).not.toHaveBeenCalled();
  await press('View community');
  expect(mockInvalidate.mock.invocationCallOrder[0]).toBeLessThan(mockDismissTo.mock.invocationCallOrder[0]);
  expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/friends/manage/(tools)/today');
});

it('awaits receipt rechecking before selecting the community and dismissing setup, without pushing another workspace', async () => {
  const finish = deferred<string>(); mockFinish.mockReturnValue(finish.promise);
  await mountSetup(); await fillAndCreate();
  const open = action('View community')!.props.onPress;
  await act(async () => { open(); open(); });
  expect(mockFinish).toHaveBeenCalledTimes(1); expect(mockSelect).not.toHaveBeenCalled();
  expect(mockDismissTo).not.toHaveBeenCalled();
  await act(async () => finish.resolve('new-community-id'));
  expect(mockSelect).toHaveBeenCalledWith('new-community-id');
  expect(mockSelect.mock.invocationCallOrder[0]).toBeLessThan(mockDismissTo.mock.invocationCallOrder[0]);
  expect(mockDismissTo).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled();
});

it('does not select or navigate when the receipt returns after the setup visit retires', async () => {
  const finish = deferred<string>(); mockFinish.mockReturnValue(finish.promise);
  await mountSetup(); await fillAndCreate(); await press('View community');
  retireSetup(); await act(async () => finish.resolve('new-community-id'));
  expect(mockWorkspace).not.toHaveBeenCalled(); expect(mockSelect).not.toHaveBeenCalled();
  expect(mockDismissTo).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});
