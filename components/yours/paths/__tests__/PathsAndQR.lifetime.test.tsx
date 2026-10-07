import React from 'react';
import { Modal, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import PathsSheet, { type PathsSheetProps } from '../PathsSheet';
import QRShareView from '../QRShareView';
import { AfterglowFallbackFonts } from '../../../../constants/Typography';
const mockEnsure = jest.fn(), mockInvite = jest.fn(), mockProfile = jest.fn(), mockRetry = jest.fn();
let mockUser: string | null = 'alice', mockEpoch = 0, mockLoading = false, mockError: Error | null = null;
jest.mock('../../../../hooks/useObservedUser', () => ({ useObservedUser: () => {
  const epoch = mockEpoch; return { viewerId: mockUser, epoch, isLoading: mockLoading, error: mockError, isCurrent: () => epoch === mockEpoch, retry: mockRetry };
} }));
jest.mock('../../../../hooks/useReferral', () => ({ useReferral: () => ({ ensureReferralCode: mockEnsure }) }));
jest.mock('../../../../lib/yours/invite', () => ({ ...jest.requireActual('../../../../lib/yours/invite'), openInviteComposer: (...args: unknown[]) => mockInvite(...args) }));
jest.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: (_key: string, id: string) => ({ maybeSingle: () => mockProfile(id) }) }) }) } }));
jest.mock('../../primitives/BottomSheet', () => ({ __esModule: true, default: (p: any) => require('react').createElement('Sheet', p, p.children) }));
jest.mock('../HandleLookupView', () => ({ __esModule: true, default: (p: any) => require('react').createElement('HandleLookup', p) }));
jest.mock('../PlanHistoryBacklog', () => ({ __esModule: true, default: (p: any) => require('react').createElement('PlanHistory', p) }));
jest.mock('expo-image', () => ({ Image: (p: any) => require('react').createElement('Photo', p) }));
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: (p: any) => require('react').createElement('QRCode', p) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: (p: any) => require('react').createElement('SafeArea', p, p.children) }));
const appearance = { fonts: AfterglowFallbackFonts }, cleanup: Array<() => void> = [];
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
async function flush() { await act(async () => { for (let i=0;i<10;i++) await Promise.resolve(); }); }
function observedViewer() { const epoch=mockEpoch; return { viewerId:mockUser, epoch, isLoading:mockLoading, error:mockError, isCurrent:()=>epoch===mockEpoch, retry:mockRetry }; }
function renderPaths(extra: Partial<PathsSheetProps> = {}) {
 let props: PathsSheetProps = { viewer:observedViewer(),visible:true,userId:'alice',backlogCount:3,onClose:jest.fn(),onPressPerson:jest.fn(),appearance,...extra };
 let tree!: ReturnType<typeof create>, alive=true; act(() => { tree=create(<PathsSheet {...props}/>); });
 const unmount=()=>{if(alive) act(()=>tree.unmount());alive=false;};cleanup.push(unmount);
 return { tree, unmount, get props(){return props;}, update(next:Partial<PathsSheetProps>={}){props={...props,viewer:observedViewer(),...next};act(()=>tree.update(<PathsSheet {...props}/>));},
 button:(label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0],
 text:()=>tree.root.findAllByType(Text).flatMap(n=>n.props.children).join(' ') };
}
function renderQR(extra: any = {}) {
 let props={userId:'alice',appearance,...extra}; let tree!: ReturnType<typeof create>,alive=true;act(()=>{tree=create(<QRShareView {...props}/>);});
 const unmount=()=>{if(alive)act(()=>tree.unmount());alive=false;};cleanup.push(unmount);
 return { tree,unmount,update(next:any={}){props={...props,...next};act(()=>tree.update(<QRShareView {...props}/>));},
 codes:()=>tree.root.findAllByType('QRCode' as any),text:()=>tree.root.findAllByType(Text).flatMap(n=>n.props.children).join(' '),
 button:(label:string)=>tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0] };
}
beforeEach(()=>{jest.clearAllMocks();mockUser='alice';mockEpoch=0;mockLoading=false;mockError=null;mockEnsure.mockResolvedValue('ALICE12');mockInvite.mockResolvedValue(undefined);mockProfile.mockResolvedValue({data:{first_name_display:'Alice',profile_photo_url:'https://example.invalid/alice.jpg'},error:null});});
afterEach(()=>cleanup.splice(0).forEach(fn=>fn()));
it('does not mount hidden paths or generate referrals',()=>{const f=renderPaths({visible:false});expect(f.tree.toJSON()).toBeNull();expect(mockEnsure).not.toHaveBeenCalled();});
it('hides a nested mode on parent close and reopens at the menu',()=>{const f=renderPaths();act(()=>f.button('Find by handle').props.onPress());expect(f.tree.root.findAllByType(Modal)).toHaveLength(1);f.update({visible:false});expect(f.tree.toJSON()).toBeNull();f.update({visible:true});expect(f.tree.root.findAllByType(Modal)).toHaveLength(0);expect(f.button('Past plans')).toBeDefined();});
it('preserves separate back and close actions on a child mode',()=>{const f=renderPaths();act(()=>f.button('Past plans').props.onPress());act(()=>f.button('Back to add people').props.onPress());expect(f.button('Past plans')).toBeDefined();expect(f.props.onClose).not.toHaveBeenCalled();act(()=>f.button('Find by handle').props.onPress());act(()=>f.button('Close add people').props.onPress());expect(f.props.onClose).toHaveBeenCalledTimes(1);});
it('passes appearance and retires a child callback when its mode closes',()=>{const f=renderPaths();act(()=>f.button('Find by handle').props.onPress());const child=f.tree.root.findByType('HandleLookup' as any).props;expect(child.appearance).toEqual(appearance);act(()=>f.button('Back to add people').props.onPress());act(()=>child.onPressPerson('old-target'));expect(f.props.onPressPerson).not.toHaveBeenCalled();expect(child.operationScope.isCurrent()).toBe(false);});
it('forwards the selected person once through the original parent callback',()=>{const f=renderPaths();act(()=>f.button('Past plans').props.onPress());const child=f.tree.root.findByType('PlanHistory' as any).props;act(()=>{child.onPressPerson('bea');child.onPressPerson('bea');});expect(f.props.onPressPerson).toHaveBeenCalledTimes(1);expect(f.props.onPressPerson).toHaveBeenCalledWith('bea');});
it('locks repeated invite taps until the composer opening finishes',async()=>{const p=deferred<void>();mockInvite.mockReturnValue(p.promise);const f=renderPaths();const press=f.button('Invite someone').props.onPress;act(()=>{press();press();});await flush();expect(mockEnsure).toHaveBeenCalledTimes(1);expect(mockInvite).toHaveBeenCalledTimes(1);expect(f.text()).toContain('Opening your invite');p.resolve();await flush();expect(f.button('Invite someone').props.disabled).toBe(false);expect(f.text()).not.toContain('Invite sent');});
it.each(['hidden','mode','account','unmount'])('retains no composer launch after %s while code waits',async(kind)=>{const p=deferred<string>();mockEnsure.mockReturnValue(p.promise);const f=renderPaths();act(()=>f.button('Invite someone').props.onPress());const scope=mockEnsure.mock.calls[0][1];if(kind==='hidden')f.update({visible:false});if(kind==='mode')act(()=>f.button('Show my code').props.onPress());if(kind==='account'){mockUser='bob';mockEpoch++;f.update({userId:'bob'});}if(kind==='unmount')f.unmount();p.resolve('ALICE12');await flush();expect(scope.isCurrent()).toBe(false);expect(mockInvite).not.toHaveBeenCalled();});
it('an old share guard stays retired after back to the same menu',async()=>{const p=deferred<void>();mockInvite.mockReturnValue(p.promise);const f=renderPaths();act(()=>f.button('Invite someone').props.onPress());await flush();const guard=mockInvite.mock.calls[0][1];act(()=>f.button('Find by handle').props.onPress());act(()=>f.button('Back to add people').props.onPress());expect(guard()).toBe(false);p.resolve();await flush();expect(f.text()).not.toContain('Opening your invite');});
it('invite failure stays inline and retries without reporting sent',async()=>{mockEnsure.mockRejectedValueOnce(new Error('offline'));const f=renderPaths();act(()=>f.button('Invite someone').props.onPress());await flush();expect(f.text()).toContain('Couldn’t open your invite');act(()=>f.button('Try again').props.onPress());await flush();expect(mockInvite).toHaveBeenCalledTimes(1);expect(f.text()).not.toContain('Invite sent');});
it('disables referrals until the current account is known and supports retry',async()=>{mockError=new Error('offline');const f=renderPaths();expect(f.button('Invite someone').props.disabled).toBe(true);act(()=>f.button('Try again to check account').props.onPress());expect(mockRetry).toHaveBeenCalledTimes(1);expect(mockEnsure).not.toHaveBeenCalled();});
it('renders only a valid current QR with truthful pending-invite copy',async()=>{const f=renderQR();await flush();expect(f.codes()[0].props.value).toBe('https://washedup.app/r/ALICE12');expect(f.text()).toContain('Scan to open your invite');expect(f.text()).not.toContain('scan this to add you');});
it('never shows an old QR when the current account changes',async()=>{const next=deferred<string>();const f=renderQR();await flush();mockEnsure.mockReturnValue(next.promise);mockUser='bob';mockEpoch++;f.update({userId:'bob'});expect(f.codes()).toHaveLength(0);next.resolve('BOB12');await flush();expect(f.codes()[0].props.value).toBe('https://washedup.app/r/BOB12');});
it('ignores late QR data from an account that has left and returned',async()=>{const old=deferred<string>();mockEnsure.mockReturnValueOnce(old.promise);const f=renderQR();mockUser='bob';mockEpoch++;f.update({userId:'bob'});mockUser='alice';mockEpoch++;f.update({userId:'alice'});await flush();old.resolve('OLD12');await flush();expect(f.codes()[0].props.value).toBe('https://washedup.app/r/ALICE12');});
it('QR failure offers a working retry and resets its error after success',async()=>{mockEnsure.mockRejectedValueOnce(new Error('offline'));const f=renderQR();await flush();expect(f.codes()).toHaveLength(0);act(()=>f.button('Try again to load invite code').props.onPress());await flush();expect(f.codes()).toHaveLength(1);expect(f.text()).not.toContain('Couldn’t load');});
it.each(['',null,undefined,'bad/code'])('invalid code %s never becomes a scannable link',async code=>{mockEnsure.mockResolvedValue(code);const f=renderQR();await flush();expect(f.codes()).toHaveLength(0);expect(f.text()).toContain('Couldn’t load your code');});
it('profile lookup failure preserves the valid code without a stale name/photo',async()=>{mockProfile.mockResolvedValue({data:{first_name_display:'Wrong cached name'},error:new Error('offline')});const f=renderQR();await flush();expect(f.codes()).toHaveLength(1);expect(f.text()).not.toContain('Wrong cached');});
it('shows a ready code while optional identity is pending, then enriches it',async()=>{
 const profile=deferred<any>();mockProfile.mockReturnValueOnce(profile.promise);const f=renderQR();await flush();
 expect(f.codes()[0].props.value).toBe('https://washedup.app/r/ALICE12');expect(f.text()).not.toContain('Loading your code');
 profile.resolve({data:{first_name_display:'Alice',profile_photo_url:'https://example.invalid/alice.jpg'},error:null});await flush();
 expect(f.codes()[0].props.value).toBe('https://washedup.app/r/ALICE12');expect(f.text()).toContain('Alice');expect(f.tree.root.findByType('Photo' as any).props.source.uri).toBe('https://example.invalid/alice.jpg');
});
it('a rejected optional identity lookup does not fail a valid code',async()=>{
 mockProfile.mockRejectedValueOnce(new Error('profile unavailable'));const f=renderQR();await flush();
 expect(f.codes()[0].props.value).toBe('https://washedup.app/r/ALICE12');expect(f.text()).not.toContain('Couldn’t load');expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(0);
});
it('retains optional identity that arrives before the code',async()=>{
 const code=deferred<string>();mockEnsure.mockReturnValueOnce(code.promise);const f=renderQR();await flush();expect(f.codes()).toHaveLength(0);
 code.resolve('ALICE12');await flush();expect(f.codes()[0].props.value).toBe('https://washedup.app/r/ALICE12');expect(f.text()).toContain('Alice');expect(f.tree.root.findByType('Photo' as any).props.source.uri).toBe('https://example.invalid/alice.jpg');
});
it('late identity from the previous account cannot enrich the current code',async()=>{
 const oldProfile=deferred<any>();mockProfile.mockReturnValueOnce(oldProfile.promise);const f=renderQR();await flush();
 mockUser='bob';mockEpoch++;mockEnsure.mockResolvedValue('BOB12');mockProfile.mockResolvedValue({data:{first_name_display:'Bob',profile_photo_url:null},error:null});f.update({userId:'bob'});await flush();
 oldProfile.resolve({data:{first_name_display:'Old Alice',profile_photo_url:'https://example.invalid/old.jpg'},error:null});await flush();
 expect(f.codes()[0].props.value).toBe('https://washedup.app/r/BOB12');expect(f.text()).toContain('Bob');expect(f.text()).not.toContain('Old Alice');expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(0);
});
it('late identity from a closed sheet cannot enrich its reopened visit',async()=>{
 const oldProfile=deferred<any>();mockProfile.mockReturnValueOnce(oldProfile.promise);const f=renderPaths();act(()=>f.button('Show my code').props.onPress());await flush();
 f.update({visible:false});mockProfile.mockResolvedValue({data:{first_name_display:'Current Alice',profile_photo_url:null},error:null});f.update({visible:true});act(()=>f.button('Show my code').props.onPress());await flush();
 oldProfile.resolve({data:{first_name_display:'Old Alice',profile_photo_url:'https://example.invalid/old.jpg'},error:null});await flush();
 expect(f.tree.root.findByType('QRCode' as any).props.value).toBe('https://washedup.app/r/ALICE12');expect(f.text()).toContain('Current Alice');expect(f.text()).not.toContain('Old Alice');expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(0);
});
it('failed portrait falls back without losing the code',async()=>{const f=renderQR();await flush();act(()=>f.tree.root.findByType('Photo' as any).props.onError());expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(0);expect(f.codes()).toHaveLength(1);});
it('an inactive parent scope stops code preparation',async()=>{renderQR({operationScope:{userId:'alice',isCurrent:()=>false}});await flush();expect(mockEnsure).not.toHaveBeenCalled();});
