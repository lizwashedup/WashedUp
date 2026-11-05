import {
  resetSetup, cleanupSetup, mountSetup, fillAndCreate, press, action,
  mockCreate, mockRead, mockCheck, mockFinish, mockSelect, mockWorkspace,
  mockDismissTo, mockPush, mockReplace, savedAttempt,
} from './setupCommunityHarness';

beforeEach(resetSetup);
afterEach(cleanupSetup);

it.each([
  ['View community', '/(tabs)/friends/manage/(tools)/today'],
  ['Edit page', '/creator/edit-page'],
  ['Invite people', '/creator/member-invites'],
])('selects the verified community identity before %s and removes setup from the back stack', async (label, route) => {
  await mountSetup(); await fillAndCreate();
  expect(mockSelect).not.toHaveBeenCalled(); expect(mockDismissTo).not.toHaveBeenCalled();
  await press(label);
  expect(mockFinish).toHaveBeenCalledWith(savedAttempt, expect.objectContaining({ userId: 'creator' }));
  expect(mockWorkspace).toHaveBeenCalledWith('community');
  expect(mockSelect).toHaveBeenCalledWith('new-community-id');
  expect(mockDismissTo).toHaveBeenCalledWith(route);
  expect(mockWorkspace.mock.invocationCallOrder[0]).toBeLessThan(mockSelect.mock.invocationCallOrder[0]);
  expect(mockSelect.mock.invocationCallOrder[0]).toBeLessThan(mockDismissTo.mock.invocationCallOrder[0]);
  expect(mockPush).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

it('uses the exact recovered receipt after a lost creation response without creating again', async () => {
  await mountSetup();
  mockCreate.mockRejectedValueOnce(Error('response lost')); mockRead.mockResolvedValue(savedAttempt);
  await fillAndCreate(); expect(action('View community')).toBeUndefined();
  mockCheck.mockResolvedValue('recovered-id'); mockFinish.mockResolvedValue('recovered-id');
  await press('Check status'); await press('View community');
  expect(mockSelect).toHaveBeenCalledWith('recovered-id');
  expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/friends/manage/(tools)/today');
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

it('unconfirmed creation cannot navigate or change the selected community', async () => {
  await mountSetup();
  mockCreate.mockRejectedValueOnce(Error('offline')); mockRead.mockResolvedValue(savedAttempt);
  await fillAndCreate(); await press('Check status');
  expect(action('View community')).toBeUndefined(); expect(action('Check status')).toBeDefined();
  expect(mockSelect).not.toHaveBeenCalled(); expect(mockDismissTo).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled(); expect(mockFinish).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledTimes(1);
});
