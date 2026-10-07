import React from 'react';
import { Alert, Platform, Switch, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AlbumUploadScreen from '../[eventId]';
import { PageAction } from '../../../../components/creator/pages/PageFrame';
import { Image } from 'expo-image';
let mockViewer:string|null='alice', mockEpoch=1, mockEvent='event-1', mockIdentityError:Error|null=null, mockIdentityLoading=false;
const mockRead=jest.fn(), mockDismissTo=jest.fn(), mockBack=jest.fn(), mockRetryIdentity=jest.fn(), mockPermission=jest.fn(), mockPicker=jest.fn(), mockEnqueue=jest.fn();
jest.mock('../../../../hooks/useObservedUser',()=>({useObservedUser:()=>{const scope=require('react').useMemo(()=>({viewer:mockViewer,epoch:mockEpoch}),[mockViewer,mockEpoch]);const isCurrent=require('react').useCallback(()=>scope.viewer===mockViewer&&scope.epoch===mockEpoch,[scope]);return{viewerId:mockViewer,epoch:mockEpoch,error:mockIdentityError,isLoading:mockIdentityLoading,isCurrent,retry:mockRetryIdentity};}}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({eventId:mockEvent}),useRouter:()=>({dismissTo:mockDismissTo,back:mockBack})}));
jest.mock('../../../../components/creator/pages/PageFrame',()=>({PageAction:()=>null}));
jest.mock('../../../../components/keyboard/KeyboardDoneBar',()=>({KEYBOARD_DONE_ACCESSORY_ID:'test'}));
jest.mock('@expo/vector-icons',()=>({Ionicons:()=>null}));
jest.mock('expo-web-browser',()=>({openBrowserAsync:jest.fn()}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View,useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('expo-image',()=>({Image:()=>null}));
jest.mock('expo-image-picker',()=>({requestMediaLibraryPermissionsAsync:()=>mockPermission(),launchImageLibraryAsync:(options:any)=>mockPicker(options),VideoExportPreset:{HighestQuality:1}}));
jest.mock('../../../../lib/uploadAlbumMedia',()=>({enqueueAlbumUploadBatch:(...args:any[])=>mockEnqueue(...args)}));
jest.mock('../../../../lib/supabase',()=>({supabase:{from:(table:string)=>{const filters:any[]=[];const chain:any={then:(a:any,b:any)=>mockRead(table,filters).then(a,b)};for(const op of ['select','eq','in','maybeSingle'])chain[op]=(...args:any[])=>{filters.push([op,...args]);return chain;};return chain;}}}));
let tree:ReactTestRenderer,client:QueryClient,alive=false;
const photo={uri:'file://sunset.jpg',fileName:'sunset.jpg',type:'image',width:1200,height:800,fileSize:500,exif:{DateTimeOriginal:'2026:09:19 18:15:00'}};
function responses(table:string){if(table==='events')return{title:`Sunday ${mockEvent}`};if(table==='event_members')return[{user_id:mockViewer},{user_id:'bob'}];return[{id:'bob',first_name_display:'Bob',profile_photo_url:null}];}
function serve(){mockRead.mockImplementation(async(t:string)=>({data:responses(t),error:null}));}
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(v:any)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
function content(){return <QueryClientProvider client={client}><AlbumUploadScreen/></QueryClientProvider>;}
function mount(){act(()=>{tree=create(content());alive=true;});}
function update(){act(()=>tree.update(content()));}
function unmount(){if(alive)act(()=>{tree.unmount();alive=false;});}
function words(){return tree.root.findAllByType(Text).map(n=>Array.isArray(n.props.children)?n.props.children.join(''):n.props.children).join(' ');}
function action(title='Try again'){return tree.root.findAllByType(PageAction).find(n=>n.props.title===title)!;}
function button(label:string){return tree.root.findAll(n=>n.props.accessibilityLabel===label&&typeof n.props.onPress==='function')[0];}
function picker(){return button('Pick photos and videos');}
function upload(){return button('Upload selected photos and videos');}
async function flush(){await act(async()=>{for(let i=0;i<25;i++)await Promise.resolve();});await act(async()=>{jest.advanceTimersByTime(1);for(let i=0;i<25;i++)await Promise.resolve();});}
async function pick(){await act(async()=>{await picker().props.onPress();});await flush();}
function audienceKey(){return ['albumUpload.attendees',mockEvent,mockViewer,mockEpoch];}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();alive=false;mockViewer='alice';mockEpoch=1;mockEvent='event-1';mockIdentityError=null;mockIdentityLoading=false;mockRead.mockReset();serve();mockPermission.mockReset().mockResolvedValue({granted:true});mockPicker.mockReset().mockResolvedValue({canceled:false,assets:[photo]});mockEnqueue.mockReset().mockResolvedValue(undefined);mockRetryIdentity.mockReset().mockResolvedValue(undefined);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});});
afterEach(()=>{unmount();client.clear();jest.clearAllTimers();jest.useRealTimers();jest.restoreAllMocks();});
it.each(['events','event_members','profiles'])('shows required %s failure and explicitly retries without an empty audience or enqueue',async table=>{
 mockRead.mockImplementation(async(t:string)=>t===table?{data:null,error:new Error('offline')}:{data:responses(t),error:null});mount();await flush();await pick();expect(action()).toBeDefined();expect(upload().props.disabled).toBe(true);if(table!=='events')expect(words()).not.toContain("It's just you!");await act(async()=>{await upload().props.onPress();});expect(mockEnqueue).not.toHaveBeenCalled();expect(mockRead.mock.calls.filter(c=>c[0]===table)).toHaveLength(1);serve();act(()=>action().props.onPress());await flush();expect(upload().props.disabled).toBe(false);expect(words()).toContain('1 photo, 0 videos selected');
});
it.each(['events','event_members'])('bounds a stalled %s read, retries, and refuses its late result',async table=>{
 const late=deferred<any>();mockRead.mockImplementation((t:string)=>t===table?late.promise:Promise.resolve({data:responses(t),error:null}));mount();await flush();await pick();expect(upload().props.disabled).toBe(true);expect(words()).not.toContain("It's just you!");await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(action()).toBeDefined();serve();act(()=>action().props.onPress());await flush();expect(upload().props.disabled).toBe(false);late.resolve({data:table==='events'?null:[],error:null});await flush();expect(words()).toContain('Bob');expect(upload().props.disabled).toBe(false);
});
it('shows private-to-you only after a successful empty audience and keeps the exact queue and picker contract',async()=>{
 const pending=deferred<any>();mockRead.mockImplementation((t:string)=>t==='event_members'?pending.promise:Promise.resolve({data:responses(t),error:null}));mount();await flush();await pick();expect(words()).toContain('Checking who can see');expect(words()).not.toContain("It's just you!");pending.resolve({data:[{user_id:'alice'}],error:null});await flush();expect(words()).toContain("It's just you!");await act(async()=>{await upload().props.onPress();});expect(mockPicker).toHaveBeenCalledWith({mediaTypes:['images','videos'],allowsMultipleSelection:true,selectionLimit:26,quality:1,videoMaxDuration:60,exif:true,...(Platform.OS==='ios'?{videoExportPreset:1}:{})});expect(mockEnqueue).toHaveBeenCalledWith('event-1','alice',[{localUri:photo.uri,contentType:'photo',mediaFormat:'jpg',fileSizeBytes:500,videoDurationSec:undefined,width:1200,height:800,takenAt:'2026-09-19T18:15:00Z'}],{visibleToUserIds:[],marketingConsent:false,instagram:undefined,tiktok:undefined,testimonial:undefined});expect(mockDismissTo).toHaveBeenCalledWith('/album/event-1');
});
it('keeps selections and excluded people during cached failure and disables a single busy retry',async()=>{
 mount();await flush();await pick();act(()=>tree.root.findByType(Switch).props.onValueChange());mockRead.mockImplementation(async(t:string)=>t==='event_members'?{data:null,error:new Error('offline')}:{data:responses(t),error:null});await act(async()=>{await client.invalidateQueries({queryKey:audienceKey()});});await flush();expect(words()).toContain('Bob');expect(words()).toContain('1 photo, 0 videos selected');expect(tree.root.findByType(Switch).props.value).toBe(false);expect(upload().props.disabled).toBe(true);
 const pending=deferred<any>();mockRead.mockImplementation((t:string)=>t==='event_members'?pending.promise:Promise.resolve({data:responses(t),error:null}));const retry=action().props.onPress;const count=mockRead.mock.calls.filter(c=>c[0]==='event_members').length;act(()=>{retry();retry();});await flush();expect(action('Retrying…').props.disabled).toBe(true);expect(mockRead.mock.calls.filter(c=>c[0]==='event_members')).toHaveLength(count+1);pending.resolve({data:responses('event_members'),error:null});await flush();expect(tree.root.findByType(Switch).props.value).toBe(false);await act(async()=>{await upload().props.onPress();});expect(mockEnqueue.mock.calls[0][3].visibleToUserIds).toEqual([]);
});
it('locks synchronously against repeated enqueue taps and allows an explicit retry after rejection',async()=>{
 const pending=deferred<any>();mockEnqueue.mockReturnValueOnce(pending.promise);const alert=jest.spyOn(Alert,'alert');mount();await flush();await pick();const send=upload().props.onPress;act(()=>{void send();void send();});expect(mockEnqueue).toHaveBeenCalledTimes(1);expect(upload().props.disabled).toBe(true);pending.reject(new Error('local persistence failed'));await flush();expect(alert).toHaveBeenCalledTimes(1);expect(upload().props.disabled).toBe(false);await act(async()=>{await upload().props.onPress();});expect(mockEnqueue).toHaveBeenCalledTimes(2);
});
it.each(['event','account','unmount'])('retires a deferred picker and old send callbacks on %s',async retirement=>{
 const pending=deferred<any>();mockPicker.mockReturnValue(pending.promise);mount();await flush();const send=upload().props.onPress;act(()=>{void picker().props.onPress();});await flush();if(retirement==='event')mockEvent='event-2';if(retirement==='account'){mockViewer='charlie';mockEpoch++;}if(retirement==='unmount')unmount();else{update();await flush();}pending.resolve({canceled:false,assets:[photo]});await flush();await act(async()=>{await send();});expect(mockEnqueue).not.toHaveBeenCalled();expect(mockDismissTo).not.toHaveBeenCalled();if(retirement!=='unmount')expect(tree.root.findAllByType(Image)).toHaveLength(0);
});
it('does not launch a picker after permission resolves for a retired visit',async()=>{
 const permission=deferred<any>();mockPermission.mockReturnValue(permission.promise);mount();await flush();act(()=>{void picker().props.onPress();});mockEvent='event-2';update();await flush();permission.resolve({granted:true});await flush();expect(mockPicker).not.toHaveBeenCalled();
});
it.each(['resolve','reject'])('suppresses stale enqueue %s navigation and feedback after account change',async outcome=>{
 const pending=deferred<any>();mockEnqueue.mockReturnValue(pending.promise);const alert=jest.spyOn(Alert,'alert');mount();await flush();await pick();act(()=>{void upload().props.onPress();});mockViewer='charlie';mockEpoch++;update();await flush();if(outcome==='resolve')pending.resolve(undefined);else pending.reject(new Error('failed'));await flush();expect(mockDismissTo).not.toHaveBeenCalled();expect(alert).not.toHaveBeenCalled();expect(words()).not.toContain('1 photo, 0 videos selected');
});
it('renders account loading, account recovery, signed-out and missing-event states without issuing reads',async()=>{
 mockIdentityLoading=true;mount();expect(mockRead).not.toHaveBeenCalled();mockIdentityLoading=false;mockIdentityError=new Error('offline');update();act(()=>action().props.onPress());expect(mockRetryIdentity).toHaveBeenCalledTimes(1);mockIdentityError=null;mockViewer=null;mockEpoch++;update();expect(words()).toContain('Sign in to add photos.');expect(mockRead).not.toHaveBeenCalled();mockViewer='alice';mockEvent='';mockEpoch++;update();expect(words()).toContain('This plan is unavailable.');expect(mockRead).not.toHaveBeenCalled();
});
it('treats a missing event as unavailable and never sends selected media',async()=>{
 mockRead.mockImplementation(async(t:string)=>({data:t==='events'?null:responses(t),error:null}));mount();await flush();await pick();expect(words()).toContain('This plan is unavailable.');await act(async()=>{await upload().props.onPress();});expect(mockEnqueue).not.toHaveBeenCalled();
});

it('rejects an old retry after event retirement and does not reuse another account audience',async()=>{
 mockRead.mockImplementation(async(t:string)=>t==='event_members'?{data:null,error:new Error('offline')}:{data:responses(t),error:null});mount();await flush();const oldRetry=action().props.onPress;mockEvent='event-2';serve();update();await flush();const count=mockRead.mock.calls.length;act(()=>oldRetry());await flush();expect(mockRead).toHaveBeenCalledTimes(count);
 const late=deferred<any>();mockRead.mockImplementation((t:string)=>t==='event_members'?late.promise:Promise.resolve({data:responses(t),error:null}));mockViewer='charlie';mockEpoch++;update();await flush();expect(words()).not.toContain('Bob');expect(upload().props.disabled).toBe(true);late.resolve({data:[{user_id:'charlie'}],error:null});await flush();expect(words()).toContain("It's just you!");
});
it('keeps existing video duration/size limits and photo cap',async()=>{
 mockPicker.mockResolvedValue({canceled:false,assets:[...Array.from({length:21},(_,i)=>({...photo,uri:`file://photo-${i}.jpg`})),{...photo,uri:'file://long.mov',type:'video',duration:61000},{...photo,uri:'file://big.mov',type:'video',duration:10000,fileSize:76*1024*1024},{...photo,uri:'file://unknown.mov',type:'video',duration:null},{...photo,uri:'file://clip.mov',fileName:'clip.mov',type:'video',duration:12000}]});mount();await flush();await pick();expect(words()).toContain('20 photos, 1 video selected');expect(words()).toContain('longer than 60 seconds');expect(words()).toContain('over 75 MB');await act(async()=>{await upload().props.onPress();});expect(mockEnqueue.mock.calls[0][2]).toHaveLength(21);expect(mockEnqueue.mock.calls[0][2][20]).toMatchObject({localUri:'file://clip.mov',contentType:'video',mediaFormat:'mov',videoDurationSec:12,takenAt:undefined});
});
