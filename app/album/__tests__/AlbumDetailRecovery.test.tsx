import React from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Modal, Platform, Pressable, Text, TextInput, TouchableOpacity } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AlbumDetailScreen from '../[eventId]';
import { PageAction } from '../../../components/creator/pages/PageFrame';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
let mockViewer:string|null='alice', mockEpoch=1, mockEvent='event-1', mockIdentityError:Error|null=null, mockIdentityLoading=false;
const mockRead=jest.fn(), mockRpc=jest.fn(), mockSign=jest.fn(), mockAuth=jest.fn(), mockPush=jest.fn(), mockBack=jest.fn(), mockRetryIdentity=jest.fn();
jest.mock('../../../hooks/useObservedUser',()=>({useObservedUser:()=>{const scope=require('react').useMemo(()=>({viewer:mockViewer,epoch:mockEpoch}),[mockViewer,mockEpoch]);const isCurrent=require('react').useCallback(()=>scope.viewer===mockViewer&&scope.epoch===mockEpoch,[scope]);return{viewerId:mockViewer,epoch:mockEpoch,error:mockIdentityError,isLoading:mockIdentityLoading,isCurrent,retry:mockRetryIdentity};}}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({eventId:mockEvent}),useRouter:()=>({push:mockPush,back:mockBack}),useFocusEffect:(fn:any)=>require('react').useEffect(fn,[fn])}));
jest.mock('../../../components/creator/pages/PageFrame',()=>({PageAction:()=>null}));
jest.mock('../../../components/keyboard/KeyboardDoneBar',()=>({KEYBOARD_DONE_ACCESSORY_ID:'test'}));
jest.mock('../../../components/albums/BrandedShareCanvas',()=>({BrandedShareCanvas:()=>null}));
jest.mock('react-native-view-shot',()=>({captureRef:jest.fn()}));
jest.mock('@expo/vector-icons',()=>({Ionicons:()=>null}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:require('react-native').View}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('expo-image',()=>({Image:()=>null}));
jest.mock('../../../lib/logger',()=>({logError:jest.fn()}));
jest.mock('@shopify/flash-list',()=>({FlashList:(props:any)=>require('react').createElement(require('react-native').View,null,props.ListHeaderComponent,props.data.length?props.data.map((item:any,index:number)=>require('react').createElement(require('react-native').View,{key:item.id},props.renderItem({item,index}))):props.ListEmptyComponent,props.ListFooterComponent)}));
jest.mock('../../../lib/supabase',()=>({supabase:{
 auth:{getUser:()=>mockAuth()},rpc:(...args:any[])=>mockRpc(...args),storage:{from:(bucket:string)=>({createSignedUrl:(...args:any[])=>mockSign(bucket,...args)})},
 from:(table:string)=>{const filters:any[]=[];const chain:any={then:(a:any,b:any)=>mockRead(table,filters).then(a,b)};for(const op of ['select','eq','in','is','order','maybeSingle','update'])chain[op]=(...args:any[])=>{filters.push([op,...args]);return chain;};return chain;},
}}));
let tree:ReactTestRenderer,client:QueryClient,alive=false;
const upload={id:'photo-1',user_id:'bob',media_url:'private/photo.jpg',thumbnail_url:null,display_url:null,content_type:'photo',heart_count:0,created_at:'2030-01-01'};
const responses=(table:string,filters:any[])=>{
 const id=filters.find(f=>f[0]==='eq'&&(f[1]==='event_id'||f[1]==='id'))?.[2]??mockEvent;
 if(table==='plan_albums')return{id:`album-${id}`,event_id:id,status:'ready',first_upload_at:'2030-01-01'};
 if(table==='events')return{id,title:`Sunday ${id}`,start_time:'2030-01-01T12:00:00Z',location_text:'The coast'};
 if(table==='event_members')return[{user_id:mockViewer},{user_id:'bob'}];
 if(table==='profiles')return[{id:mockViewer,first_name_display:'Alice',profile_photo_url:null},{id:'bob',first_name_display:'Bob',profile_photo_url:null}];
 if(table==='album_uploads')return[upload];
 if(table==='album_user_metadata')return{custom_name:null,memory_note:'Remember the sunset',notifications_muted:false,cover_upload_id:null};
 return[];
};
function serve(){mockRead.mockImplementation(async(table:string,filters:any[])=>({data:responses(table,filters),error:null}));}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
function content(){return <QueryClientProvider client={client}><AlbumDetailScreen/></QueryClientProvider>;}
function mount(){act(()=>{tree=create(content());alive=true;});}
function update(){act(()=>tree.update(content()));}
function unmount(){if(alive)act(()=>{tree.unmount();alive=false;});}
function words(){return tree.root.findAllByType(Text).map(n=>n.props.children).join(' ');}
function action(title='Try again'){return tree.root.findAllByType(PageAction).find(n=>n.props.title===title)!;}
async function flush(){await act(async()=>{for(let i=0;i<25;i++)await Promise.resolve();});await act(async()=>{jest.advanceTimersByTime(1);for(let i=0;i<25;i++)await Promise.resolve();});}
function queryKey(){return ['album',mockEvent,mockViewer,mockEpoch];}
function button(text:string){return tree.root.findAll(n=>typeof n.props.onPress==='function'&&n.findAllByType(Text).some(t=>t.props.children===text))[0];}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();alive=false;mockViewer='alice';mockEpoch=1;mockEvent='event-1';mockIdentityError=null;mockIdentityLoading=false;mockAuth.mockReset().mockImplementation(async()=>({data:{user:{id:mockViewer}},error:null}));mockRpc.mockReset().mockResolvedValue({error:null});mockSign.mockReset().mockResolvedValue({data:{signedUrl:'https://example.invalid/signed'},error:null});mockRetryIdentity.mockReset().mockResolvedValue(undefined);mockRead.mockReset();serve();client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});});
afterEach(()=>{unmount();client.clear();jest.clearAllTimers();jest.useRealTimers();});
it.each(['plan_albums','events','event_members','album_uploads','profiles','album_hearts','album_user_metadata'])('rejects required %s errors instead of showing missing/empty or incomplete personal data',async table=>{
 mockRead.mockImplementation(async(t:string,f:any[])=>t===table?{data:null,error:new Error('offline')}:{data:responses(t,f),error:null});mount();await flush();expect(action()).toBeDefined();expect(words()).not.toContain("hasn't started");expect(tree.root.findAllByType(FlashList)).toHaveLength(0);
});
it('initial failure explicitly retries without automatic query retries',async()=>{
 mockRead.mockImplementation(async(t:string,f:any[])=>t==='plan_albums'?{data:null,error:new Error('offline')}:{data:responses(t,f),error:null});mount();await flush();expect(mockRead.mock.calls.filter(c=>c[0]==='plan_albums')).toHaveLength(1);serve();act(()=>action().props.onPress());await flush();expect(words()).toContain('Sunday event-1');expect(tree.root.findByType(FlashList).props.data).toHaveLength(1);
});
it('shows finite initial loading, then timeout recovery, ignoring the late result',async()=>{
 const late=deferred<any>();mockRead.mockImplementation((t:string,f:any[])=>t==='plan_albums'?late.promise:Promise.resolve({data:responses(t,f),error:null}));mount();expect(tree.root.findByType(ActivityIndicator).props.accessibilityLabel).toBe('Loading album');await act(async()=>{jest.advanceTimersByTime(24000);});await flush();expect(action()).toBeDefined();serve();act(()=>action().props.onPress());await flush();expect(words()).toContain('Sunday event-1');late.resolve({data:null,error:null});await flush();expect(tree.root.findAllByType(FlashList)).toHaveLength(1);
});
it('keeps cached photos, personal note and upload navigation visible through refresh failure and busy retry',async()=>{
 mount();await flush();const list=tree.root.findByType(FlashList);const original=list.props.data;mockRead.mockImplementation(async(t:string,f:any[])=>t==='album_uploads'?{data:null,error:new Error('offline')}:{data:responses(t,f),error:null});await act(async()=>{await client.invalidateQueries({queryKey:queryKey()});});await flush();expect(words()).toContain('Couldn’t refresh. Your album is still here.');expect(tree.root.findByType(FlashList).props.data).toEqual(original);expect(tree.root.findByType(TextInput).props.value).toBe('Remember the sunset');act(()=>button('Add photos').props.onPress());expect(mockPush).toHaveBeenCalledWith('/album/upload/event-1');
 const stalled=deferred<any>();mockRead.mockImplementation((t:string,f:any[])=>t==='plan_albums'?stalled.promise:Promise.resolve({data:responses(t,f),error:null}));const before=mockRead.mock.calls.filter(c=>c[0]==='plan_albums').length;const retry=action().props.onPress;act(()=>{retry();retry();});await flush();expect(action('Retrying…').props.disabled).toBe(true);expect(mockRead.mock.calls.filter(c=>c[0]==='plan_albums')).toHaveLength(before+1);expect(tree.root.findAllByType(FlashList)).toHaveLength(1);stalled.resolve({data:responses('plan_albums',[]),error:null});await flush();
});
it('distinguishes a confirmed unstarted album from an unavailable event and a confirmed empty album',async()=>{
 mockRead.mockImplementation(async(t:string,f:any[])=>({data:t==='plan_albums'?null:responses(t,f),error:null}));mount();await flush();expect(words()).toContain("This album hasn't started yet.");unmount();client.clear();
 mockRead.mockImplementation(async(t:string,f:any[])=>({data:t==='events'?null:responses(t,f),error:null}));mount();await flush();expect(words()).toContain('This album is unavailable.');unmount();client.clear();
 mockRead.mockImplementation(async(t:string,f:any[])=>({data:t==='album_uploads'?[]:responses(t,f),error:null}));mount();await flush();expect(words()).toContain('Be the first to add some photos.');
});
it('preserves signing failures as optional image fallbacks',async()=>{
 mockSign.mockResolvedValue({data:null,error:new Error('storage unavailable')});mount();await flush();expect(tree.root.findByType(FlashList).props.data[0]).toMatchObject({signed_display_url:null,signed_thumb_url:null});expect(action()).toBeUndefined();expect(mockSign).toHaveBeenCalledTimes(2);
});
it.each(['event','account','unmount'])('retires cached navigation, menu actions and pending note writes on %s',async retirement=>{
 mount();await flush();const add=button('Add photos').props.onPress;const rename=tree.root.findAll(n=>n.props.accessibilityLabel==='Rename album'&&typeof n.props.onPress==='function')[0].props.onPress;const note=tree.root.findByType(TextInput);act(()=>note.props.onChangeText('A pending edit'));
 if(retirement==='event')mockEvent='event-2';if(retirement==='account'){mockViewer='charlie';mockEpoch++;}if(retirement==='unmount')unmount();else{update();await flush();}
 const before=mockRpc.mock.calls.length;act(()=>{add();rename();jest.advanceTimersByTime(700);});await flush();expect(mockPush).not.toHaveBeenCalled();expect(mockRpc.mock.calls.slice(before).filter(c=>c[0]==='set_album_user_metadata')).toHaveLength(0);if(retirement!=='unmount'){expect(tree.root.findByType(TextInput).props.value).toBe('Remember the sunset');expect(words()).toContain(`Sunday ${mockEvent}`);}
});
it('does not reuse another viewer cache or accept an auth identity mismatch',async()=>{
 mount();await flush();expect(client.getQueryData(['album','event-1','alice',1])).toBeDefined();mockViewer='charlie';mockEpoch++;mockAuth.mockResolvedValue({data:{user:{id:'alice'}},error:null});update();await flush();expect(tree.root.findAllByType(FlashList)).toHaveLength(0);expect(action()).toBeDefined();
});
it('ignores an old event result after switching routes',async()=>{
 const old=deferred<any>();mockRead.mockImplementation((t:string,f:any[])=>t==='plan_albums'?old.promise:Promise.resolve({data:responses(t,f),error:null}));mount();mockEvent='event-2';serve();update();await flush();expect(words()).toContain('Sunday event-2');old.resolve({data:responses('plan_albums',[['eq','event_id','event-1']]),error:null});await flush();expect(words()).not.toContain('Sunday event-1');expect(client.getQueryData(['album','event-1','alice',1])).toBeUndefined();
});
it('checks identity before reading and offers account retry instead of mounting an album',async()=>{
 mockIdentityLoading=true;mount();expect(mockRead).not.toHaveBeenCalled();mockIdentityLoading=false;mockIdentityError=new Error('auth offline');update();act(()=>action().props.onPress());expect(mockRetryIdentity).toHaveBeenCalledTimes(1);expect(mockRead).not.toHaveBeenCalled();
});

it('retains current heart action but rejects its delayed menu selection after an event change',async()=>{
 const sheet=jest.spyOn(ActionSheetIOS,'showActionSheetWithOptions').mockImplementation(()=>{}); const alert=jest.spyOn(Alert,'alert');mount();await flush();
 const tile=tree.root.findAll(n=>typeof n.props.onLongPress==='function')[0];act(()=>tile.props.onLongPress());
 const pick=Platform.OS==='ios'?()=>sheet.mock.calls.at(-1)![1](0):()=>alert.mock.calls.at(-1)![2]![0].onPress!();
 const oldSelection=sheet.mock.calls.at(-1)?.[1];const oldAlert=alert.mock.calls.at(-1)?.[2]?.[0].onPress;
 const retained=()=>{if(Platform.OS==='ios')oldSelection!(0);else oldAlert!();};
 await act(async()=>{pick();});await flush();expect(mockRpc).toHaveBeenCalledWith('record_album_heart',{p_upload_id:'photo-1'});
 mockEvent='event-2';update();await flush();const before=mockRpc.mock.calls.length;await act(async()=>{retained();});expect(mockRpc.mock.calls.length).toBe(before);sheet.mockRestore();alert.mockRestore();
});
it('keeps the existing explicit personal-name save parameters',async()=>{
 mount();await flush();const rename=tree.root.findAll(n=>n.props.accessibilityLabel==='Rename album'&&typeof n.props.onPress==='function')[0];act(()=>rename.props.onPress());
 const input=tree.root.findAllByType(TextInput).find(n=>n.props.maxLength===80)!;act(()=>input.props.onChangeText('Golden afternoon'));
 const save=tree.root.findAll(n=>n.props.accessibilityLabel==='Save album name'&&typeof n.props.onPress==='function')[0];await act(async()=>{await save.props.onPress();});
 expect(mockRpc).toHaveBeenCalledWith('set_album_user_metadata',{p_plan_album_id:'album-event-1',p_custom_name:'Golden afternoon',p_memory_note:'Remember the sunset',p_notifications_muted:false,p_cover_upload_id:null});
});

it('allows optional full and thumbnail signing timeouts to fall back without failing the album',async()=>{
 mockSign.mockImplementation(()=>new Promise(()=>{}));mount();await flush();await act(async()=>{jest.advanceTimersByTime(8000);});await flush();await act(async()=>{jest.advanceTimersByTime(8000);});await flush();expect(tree.root.findByType(FlashList).props.data[0]).toMatchObject({signed_display_url:null,signed_thumb_url:null});expect(action()).toBeUndefined();
});
it('offers recovery if a previously missing album cannot be checked again',async()=>{
 mockRead.mockImplementation(async(t:string,f:any[])=>({data:t==='plan_albums'?null:responses(t,f),error:null}));mount();await flush();expect(words()).toContain("hasn't started yet");mockRead.mockImplementation(async()=>({data:null,error:new Error('offline')}));await act(async()=>{await client.invalidateQueries({queryKey:queryKey()});});await flush();expect(action()).toBeDefined();expect(words()).not.toContain("hasn't started yet");
});
