import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mockRead = jest.fn(), mockUser = jest.fn(), mockFollow = jest.fn();
const mockListeners = new Set<(event: string, session: any) => void>();
jest.mock('../../../lib/supabase', () => ({ supabase: { auth: { getUser: () => mockUser(), onAuthStateChange: (fn: any) => { mockListeners.add(fn); return { data: { subscription: { unsubscribe: () => mockListeners.delete(fn) } } }; } } } }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'alice' }), router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null }, Redirect: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../../constants/FeatureFlags', () => ({ CREATOR_PAGES_ENABLED: true, COMMUNITIES_ENABLED: true }));
jest.mock('../../../components/ProfileButton', () => () => null);
jest.mock('../../../components/creator/OrganizationManageLink', () => ({ OrganizationManageLink: () => require('react').createElement(require('react-native').Text, null, 'Manage own organization') }));
jest.mock('../../../components/creator/pages/PublicOrganizationPageScreen', () => () => null);
jest.mock('../../../components/events/EventMediaImage', () => ({ EventMediaImage: () => null }));
jest.mock('../../../lib/organizerProfile', () => ({ getOrganizationPage: () => mockRead() }));
jest.mock('../../../lib/organizerFollows', () => ({ getFollowerCount: async () => null, getFollowState: (...args: any[]) => mockFollow(...args) }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: () => {}, hapticError: () => {}, hapticSuccess: () => {} }));
jest.mock('../../../lib/url', () => ({ openUrl: jest.fn() }));
import Route from '../[id]';
import { retireObservedUserRead } from '../../../lib/observedUserRead';
let tree: ReactTestRenderer; let client: QueryClient;
const words = () => tree.root.findAllByType(Text).map(n => n.props.children).flat().join(' ');
const retry = () => tree.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === 'Retry account check');
async function flush() { await act(async () => { for(let i=0;i<20;i++)await Promise.resolve(); }); await act(async () => jest.advanceTimersByTime(1)); }
async function mount() { await act(async () => { tree=create(<QueryClientProvider client={client}><Route /></QueryClientProvider>); }); await flush(); }
async function emit(id: string|null) { act(() => { for(const fn of mockListeners)fn(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null); }); await flush(); }
beforeEach(() => { jest.useFakeTimers();retireObservedUserRead();mockListeners.clear();mockUser.mockReset().mockResolvedValue({data:{user:{id:'alice'}},error:null});mockFollow.mockReset().mockResolvedValue({available:true,following:false});mockRead.mockReset().mockResolvedValue({profile:{user_id:'alice',display_name:'Local Walks',city:null,bio:null,logo_url:null,link_url:null},upcomingEvents:[],pastEvents:[]});client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}}); });
afterEach(() => { act(() => tree?.unmount());client.clear();retireObservedUserRead();jest.useRealTimers(); });
it('stops showing the previous account management action on account switch',async()=>{await mount();expect(words()).toContain('Manage own organization');await emit('bob');expect(words()).not.toContain('Manage own organization');expect(mockFollow).toHaveBeenCalledWith({kind:'organizer',id:'alice'},'bob');});
it('clears personal actions on sign-out while preserving the public page',async()=>{await mount();await emit(null);expect(words()).not.toContain('Manage own organization');expect(words()).toContain('Local Walks');});
it('does not trust the old infinitely cached auth identity',async()=>{client.setQueryData(['auth-user-id'],'alice');mockUser.mockResolvedValue({data:{user:{id:'bob'}},error:null});await mount();expect(words()).not.toContain('Manage own organization');expect(mockFollow).toHaveBeenCalledWith({kind:'organizer',id:'alice'},'bob');});
it('recovers a stalled account check without hiding public details',async()=>{mockUser.mockImplementationOnce(()=>new Promise(()=>{}));await mount();await act(async()=>jest.advanceTimersByTime(12000));await flush();expect(words()).toContain('Local Walks');expect(retry()).toBeDefined();act(()=>retry()!.props.onPress());await flush();expect(words()).toContain('Manage own organization');});
it('keeps signed-out public browsing available',async()=>{mockUser.mockResolvedValue({data:{user:null},error:{name:'AuthSessionMissingError'}});await mount();expect(words()).toContain('Local Walks');expect(words()).not.toContain('Manage own organization');expect(mockFollow).not.toHaveBeenCalled();expect(retry()).toBeUndefined();});
it('reads follow state again after the same account signs out and returns',async()=>{mockUser.mockResolvedValue({data:{user:{id:'bob'}},error:null});await mount();expect(mockFollow).toHaveBeenCalledTimes(1);await emit(null);await emit('bob');expect(mockFollow).toHaveBeenCalledTimes(2);});
it('ignores the old initial account result after a newer sign-in',async()=>{let resolve!:(value:any)=>void;mockUser.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));await mount();await emit('bob');await act(async()=>resolve({data:{user:{id:'alice'}},error:null}));await flush();expect(words()).not.toContain('Manage own organization');expect(mockFollow).toHaveBeenCalledWith({kind:'organizer',id:'alice'},'bob');});
