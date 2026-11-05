import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Linking } from 'react-native';
let mockAccess: any, mockObserved: any, live: boolean;
const mockGrants = jest.fn(), mockRetry = jest.fn();
jest.mock('../../../hooks/useCreatorAccessRead', () => ({ useCreatorAccessRead: () => mockAccess }));
jest.mock('../../../hooks/useCreatorPageScope', () => ({ useCreatorPageScope: () => mockObserved }));
jest.mock('../../../lib/operatorApplications', () => ({ fetchMyGrants: (...args: unknown[]) => mockGrants(...args) }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').CreatorFonts }) }));
jest.mock('../../../components/creator/pages/PageFrame', () => ({
  PageFrame: ({ children }: any) => children,
  PageAction: () => null,
  pageStyles: {},
}));
import Screen from '../help';
import { PageAction } from '../../../components/creator/pages/PageFrame';
let tree: ReactTestRenderer;
const text = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : (node?.children ?? []).map(text).join(' ');
const visible = () => text(tree.toJSON());
const action = (label: string) => tree.root.findAllByType(PageAction).find(node => (node.props.accessibilityLabel ?? node.props.title) === label)!;
const mount = async () => { await act(async () => { tree = create(<Screen />); }); };
const update = async () => { await act(async () => tree.update(<Screen />)); };
beforeEach(() => {
  jest.clearAllMocks(); live = true;
  mockObserved = { scope: {userId:'alice', isCurrent:()=>live}, account:{viewerId:'alice', isLoading:false,error:null,retry:mockRetry} };
  mockAccess = { data:{ledCommunities:[],hasLeaderGrant:false,hasEventHostGrant:false},isLoading:false,isError:false,isFetching:false,refetch:mockRetry };
  mockGrants.mockResolvedValue([]);
});
afterEach(() => { act(() => tree?.unmount()); jest.restoreAllMocks(); });
it('labels each selected community role accurately without promoting collaborators to co-leaders', async () => {
  const roles = ['leader','co_leader','admin','events','member_care','finance'];
  mockAccess.data.ledCommunities=roles.map(role=>({id:role,name:`Community ${role}`,role}));
  await mount();
  for(const label of ['Leader','Co-leader','Admin','Events','Member care','Finance']) expect(visible()).toContain(label);
  expect(visible().match(/Co-leader/g)).toHaveLength(1);
  expect(visible()).not.toContain('you lead 6');
  expect(visible()).not.toContain('No active creator access');
  expect(mockGrants).toHaveBeenCalledWith('alice');
});
it('shows errors separately from missing access and missing applications', async () => {
  mockAccess.isError=true; mockGrants.mockRejectedValueOnce(Error('offline')); await mount();
  expect(visible()).toContain('Couldn’t check your creator access.');
  expect(visible()).toContain('Couldn’t load your application status.');
  expect(visible()).not.toContain('No active creator access');
  expect(visible()).not.toContain('No application');
  await act(async()=>action('Retry creator access').props.onPress());expect(mockRetry).toHaveBeenCalledTimes(1);
  mockGrants.mockResolvedValue([{track:'event_host',status:'needs_more_info',applicant_message:'Please add your public name.'}]);
  await act(async()=>action('Retry application status').props.onPress());
  expect(visible()).toContain('More information needed');expect(visible()).toContain('Please add your public name.');
});
it('distinguishes a submitted application from one already in review', async () => {
  mockGrants.mockResolvedValue([{track:'community_leader',status:'applied'},{track:'event_host',status:'in_review'}]);
  await mount();expect(visible()).toContain('Submitted');expect(visible()).toContain('In review');
  expect(visible()).not.toContain('a real person is reading');
});
it('does not show an earlier account’s late application result', async () => {
  let resolve!: (value: unknown) => void;
  mockGrants.mockReturnValueOnce(new Promise(done=>{resolve=done;}));await mount();
  live=false;
  mockObserved={scope:{userId:'bob',isCurrent:()=>true},account:{viewerId:'bob',isLoading:false,error:null,retry:mockRetry}};
  mockGrants.mockResolvedValue([]); await update();
  await act(async()=>resolve([{track:'event_host',status:'approved',applicant_message:'Alice private review'}]));
  expect(visible()).not.toContain('Alice private review');expect(visible()).toContain('No application');
});
it('does not read applications while signed out or while account verification failed', async () => {
  mockObserved={scope:null,account:{viewerId:null,isLoading:false,error:null,retry:mockRetry}};
  await mount();expect(mockGrants).not.toHaveBeenCalled();expect(visible()).toContain('Sign in to view your applications.');
  mockObserved.account.error=Error('unavailable');await update();
  expect(visible()).not.toContain('No application');expect(visible()).toContain('Couldn’t load your application status.');
});
it('keeps the support address visible when the email app cannot open', async () => {
  jest.spyOn(Linking,'openURL').mockRejectedValue(Error('no mail app'));await mount();
  await act(async()=>action('Contact support').props.onPress());
  expect(Linking.openURL).toHaveBeenCalledWith('mailto:hello@washedup.app');
  expect(visible()).toContain('Email didn’t open.');expect(visible()).toContain('hello@washedup.app');
});
