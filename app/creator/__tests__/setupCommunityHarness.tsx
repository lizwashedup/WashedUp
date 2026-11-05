import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

export const mockCreate = jest.fn(), mockRead = jest.fn(), mockCheck = jest.fn(), mockFinish = jest.fn();
export const mockSelect = jest.fn(), mockWorkspace = jest.fn(), mockInvalidate = jest.fn();
export const mockDismissTo = jest.fn(), mockPush = jest.fn(), mockReplace = jest.fn();
let mockCurrent = true;
const mockScope = { userId: 'creator', isCurrent: () => mockCurrent };

jest.mock('../../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => ({ scope: mockScope, account: { isLoading: false, error: null, epoch: 1 } }) }));
jest.mock('../../../hooks/useCreatorAccessRead', () => ({ useCreatorAccessRead: () => ({ data: { hasLeaderGrant: true }, isLoading: false, isError: false, refetch: jest.fn() }) }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: { regular: 'System', medium: 'System', display: 'System' } }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: (...args: unknown[]) => mockInvalidate(...args) }) }));
jest.mock('../../../lib/creatorMode', () => ({ suggestHandle: () => 'new-community', HANDLE_SHAPE: /^[a-z-]{3,40}$/ }));
jest.mock('../../../lib/communityJoiningOptions', () => ({ getCommunityJoiningOptions: async () => ({ version: 1 }) }));
jest.mock('../../../lib/communityCreation', () => ({
  createCommunityWithJoining: (...args: unknown[]) => mockCreate(...args),
  readCommunityCreationAttempt: (...args: unknown[]) => mockRead(...args),
  checkCommunityCreation: (...args: unknown[]) => mockCheck(...args),
  finishCommunityCreation: (...args: unknown[]) => mockFinish(...args),
}));
jest.mock('../../../lib/selectedCommunity', () => ({ setSelectedCommunityId: (...args: unknown[]) => mockSelect(...args) }));
jest.mock('../../../lib/workspaceContext', () => ({ setWorkspace: (...args: unknown[]) => mockWorkspace(...args) }));
jest.mock('../../../lib/houseCommunity', () => ({ isHouseCommunity: () => false }));
jest.mock('../../../lib/haptics', () => ({ hapticSuccess: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({ supabase: { rpc: async () => ({ data: true, error: null }) } }));
jest.mock('expo-router', () => ({ router: {
  dismissTo: (...args: unknown[]) => mockDismissTo(...args), push: (...args: unknown[]) => mockPush(...args),
  replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn(),
}, Stack: { Screen: () => null } }));
jest.mock('../../../components/creator/pages/PageFrame', () => ({
  PageFrame: ({ children }: any) => require('react').createElement('Frame', {}, children),
  PageAction: (props: any) => require('react').createElement('Action', props), pageStyles: {},
}));
jest.mock('../../../components/creator/ApplyFormKit', () => ({ Field: (props: any) => require('react').createElement('Field', props) }));

import SetupCommunityScreen from '../setup-community';
import { PageAction } from '../../../components/creator/pages/PageFrame';
import { Field } from '../../../components/creator/ApplyFormKit';
import { CommunityJoiningChoice } from '../../../components/creator/CommunityJoiningChoice';

let tree: ReactTestRenderer | null = null;
export const savedAttempt = { userId: 'creator', requestId: 'request', details: {
  name: 'New community', handle: 'new-community', city: 'Los Angeles',
  purpose: 'Bring our neighborhood together', method: 'approval_required',
} };
export const action = (title: string) => tree!.root.findAllByType(PageAction).find(node => node.props.title === title);
export function retireSetup() { mockCurrent = false; }
export async function press(title: string) {
  await act(async () => { const target = action(title); expect(target).toBeDefined(); expect(target!.props.disabled).not.toBe(true); target!.props.onPress(); });
}
export async function mountSetup() { await act(async () => { tree = create(<SetupCommunityScreen />); }); }
export async function fillAndCreate() {
  const field = (label: string) => tree!.root.findAllByType(Field).find(node => node.props.label === label)!;
  act(() => field('Community name').props.onChange(savedAttempt.details.name));
  act(() => field('What brings people together?').props.onChange(savedAttempt.details.purpose));
  await press('Continue'); expect(action('Create community')!.props.disabled).toBe(true);
  act(() => tree!.root.findByType(CommunityJoiningChoice).props.onChange(savedAttempt.details.method));
  await press('Create community');
}
export function resetSetup() {
  jest.clearAllMocks(); mockCurrent = true;
  mockCreate.mockReset().mockResolvedValue({ id: 'new-community-id', attempt: savedAttempt });
  mockRead.mockReset().mockResolvedValue(null); mockCheck.mockReset().mockResolvedValue(null);
  mockFinish.mockReset().mockResolvedValue('new-community-id'); mockInvalidate.mockReset().mockResolvedValue(undefined);
}
export async function cleanupSetup() { if (tree) await act(async () => { tree!.unmount(); tree = null; }); }
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
