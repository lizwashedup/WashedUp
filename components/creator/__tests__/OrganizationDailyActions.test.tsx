import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockPush = jest.fn(), mockRead = jest.fn(), mockPrepare = jest.fn();
let mockActive = true;
const mockScope = { userId: 'creator', isCurrent: () => mockActive };
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('../../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => ({ scope: mockScope, account: { isLoading: false, error: null } }) }));
jest.mock('../../../lib/creatorMode', () => ({ getCreatorAccess: (...args: unknown[]) => mockRead(...args) }));
jest.mock('../../../lib/creatorManagement', () => ({ prepareCreatorSpace: (...args: unknown[]) => mockPrepare(...args) }));
jest.mock('../pages/PageFrame', () => ({ PageAction: (props: any) => require('react').createElement('Action', props), pageStyles: {} }));
import { OrganizationDailyActions } from '../OrganizationDailyActions';
let tree: ReactTestRenderer;
beforeEach(() => { jest.clearAllMocks(); mockActive = true; mockRead.mockResolvedValue({ hasEventHostGrant: true }); act(() => { tree = create(<OrganizationDailyActions />); }); });
afterEach(() => act(() => tree.unmount()));
const press = (title: string) => tree.root.findAllByType('Action' as any).find(node => node.props.title === title)!.props.onPress();
it.each([['Events', 'events'], ['Settings', 'menu']])('opens %s under Yours using a freshly approved organization', async (title, screen) => {
  await act(async () => press(title));
  expect(mockPrepare).toHaveBeenCalledWith(expect.objectContaining({ legacy: { workspace: 'organization', status: 'approved' } }), mockScope);
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/friends/manage/(tools)/' + screen);
});
it('prevents double navigation while checking approval', async () => {
  let finish!: (value: unknown) => void; mockRead.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  act(() => { press('Events'); press('Settings'); }); expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => finish({ hasEventHostGrant: true })); expect(mockPush).toHaveBeenCalledTimes(1);
});
it('does not use an approval after the account or visit changes', async () => {
  mockRead.mockImplementation(async () => { mockActive = false; return { hasEventHostGrant: true }; });
  await act(async () => press('Events')); expect(mockPush).not.toHaveBeenCalled(); expect(mockPrepare).not.toHaveBeenCalled();
});
it('keeps revoked access out of organization tools', async () => {
  mockRead.mockResolvedValue({ hasEventHostGrant: false }); await act(async () => press('Settings'));
  expect(mockPush).not.toHaveBeenCalled(); expect(JSON.stringify(tree.toJSON())).toContain('Your access has changed');
});
