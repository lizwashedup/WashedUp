import React from 'react';
import { ActivityIndicator, Alert, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlbumsGrid } from '../AlbumsGrid';
import { PolaroidCard } from '../PolaroidCard';
import { PageAction } from '../../creator/pages/PageFrame';
const mockPush = jest.fn(), mockRead = jest.fn(), mockSign = jest.fn(), mockRpc = jest.fn();
const mockFilters: any[] = [];
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: (fn:any) => require('react').useEffect(fn, [fn]) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn().mockResolvedValue(null) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../PolaroidCard', () => ({ PolaroidCard: () => null }));
jest.mock('../PolaroidEmptyIcon', () => ({ PolaroidEmptyIcon: () => null }));
jest.mock('../../creator/pages/PageFrame', () => ({ PageAction: () => null }));
jest.mock('../../../lib/supabase', () => ({ supabase: {
 from: (table:string) => {
  const chain:any = { then: (yes:any,no:any) => mockRead(table).then(yes,no) };
  for (const op of ['select','eq','in','is','not','order']) chain[op]=(...args:any[])=>{mockFilters.push([table,op,...args]);return chain;};
  return chain;
 }, storage: {from: (bucket:string) => ({createSignedUrl: (path:string,ttl:number) => mockSign(bucket,path,ttl)})}, rpc: (...args:any[])=>mockRpc(...args),
} }));
let tree:ReactTestRenderer, client:QueryClient, alive=false, userId='alice';
const album = {id:'album-1',event_id:'event-1',status:'ready',first_upload_at:'2030-01-01',prompt_sent_at:null,created_at:'2030-01-01',event_title:'Sunday together',custom_name:'Our afternoon',event_start_time:'2030-01-01T12:00:00Z',cover_signed_url:'https://example.invalid/signed',cover_cache_key:'folder/photo.jpg'};
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{resolve,promise};}
function content(){return <QueryClientProvider client={client}><AlbumsGrid userId={userId}/></QueryClientProvider>;}
function mount(){act(()=>{tree=create(content());alive=true;});}
function update(){act(()=>tree.update(content()));}
function unmount(){if(alive)act(()=>{tree.unmount();alive=false;});}
function words(){return tree.root.findAllByType(Text).map(n=>n.props.children).join(' ');}
function action(title='Try again'){return tree.root.findAllByType(PageAction).find(n=>n.props.title===title)!;}
async function flush(){await act(async()=>{for(let i=0;i<12;i++)await Promise.resolve();});await act(async()=>{jest.advanceTimersByTime(1);for(let i=0;i<12;i++)await Promise.resolve();});}
function serveAlbum(){mockRead.mockImplementation(async(table:string)=>({data:table==='event_members'?[{event_id:'event-1'}]:table==='plan_albums'?[album]:table==='events'?[{id:'event-1',title:'Sunday together',start_time:album.event_start_time,image_url:'https://example.invalid/event.jpg'}]:table==='album_user_metadata'?[{plan_album_id:album.id,custom_name:'Our afternoon',cover_upload_id:'photo-1'}]:table==='album_uploads'?[{id:'photo-1',plan_album_id:album.id,display_url:'folder/photo.jpg',media_url:null}]:[],error:null}));}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockFilters.length=0;alive=false;userId='alice';mockRead.mockReset().mockResolvedValue({data:[],error:null});mockSign.mockReset().mockResolvedValue({data:{signedUrl:'https://example.invalid/signed'},error:null});mockRpc.mockReset().mockResolvedValue({error:null});client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});});
afterEach(()=>{unmount();client.clear();jest.useRealTimers();});
it('shows loading until an initial read succeeds, then the confirmed empty invitation',async()=>{
 const read=deferred<any>();mockRead.mockReturnValueOnce(read.promise);mount();expect(tree.root.findByType(ActivityIndicator).props.accessibilityLabel).toBe('Loading albums');expect(words()).not.toContain('Your albums will live here');
 read.resolve({data:[],error:null});await flush();expect(words()).toContain('Your albums will live here.');expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
});
it('shows an explicit initial retry and does not automatically retry the failed read',async()=>{
 mockRead.mockResolvedValueOnce({data:null,error:new Error('offline')});mount();await flush();expect(words()).toContain('Your albums couldn’t load');expect(words()).not.toContain('Pull to retry');expect(words()).not.toContain('Your albums will live here');expect(mockRead).toHaveBeenCalledTimes(1);
 act(()=>action().props.onPress());await flush();expect(words()).toContain('Your albums will live here.');expect(mockRead).toHaveBeenCalledTimes(2);
});
it('bounds a stalled read and ignores its late empty result after successful explicit retry',async()=>{
 const late=deferred<any>();mockRead.mockReturnValueOnce(late.promise);mount();await act(async()=>{jest.advanceTimersByTime(12000);});await flush();expect(words()).toContain('Your albums couldn’t load');expect(mockRead).toHaveBeenCalledTimes(1);
 serveAlbum();act(()=>action().props.onPress());await flush();expect(tree.root.findByType(PolaroidCard).props.title).toBe('Our afternoon');late.resolve({data:[],error:null});await flush();expect(tree.root.findAllByType(PolaroidCard)).toHaveLength(1);
});
it('retains cached albums and their route during a failed refresh, with one busy retry',async()=>{
 client.setQueryData(['albumsGrid','alice'],[album],{updatedAt:Date.now()-120000});mockRead.mockResolvedValueOnce({data:null,error:new Error('offline')});mount();await flush();
 expect(words()).toContain('Couldn’t refresh. Your albums are still here.');expect(tree.root.findAllByType(PolaroidCard)).toHaveLength(1);
 const pending=deferred<any>();mockRead.mockReturnValueOnce(pending.promise);const retry=action().props.onPress;act(()=>{retry();retry();});await flush();expect(action('Retrying…').props.disabled).toBe(true);expect(mockRead).toHaveBeenCalledTimes(2);expect(tree.root.findAllByType(PolaroidCard)).toHaveLength(1);
 act(()=>tree.root.findByType(PolaroidCard).props.onPress());expect(mockPush).toHaveBeenCalledWith('/album/event-1');pending.resolve({data:[],error:null});await flush();expect(words()).toContain('Your albums will live here.');
});
it('preserves membership filtering, archive exclusion, personal cover choice and private URL signing',async()=>{
 serveAlbum();mount();await flush();expect(mockFilters).toEqual(expect.arrayContaining([['event_members','eq','user_id','alice'],['event_members','eq','status','joined'],['plan_albums','is','archived_at',null],['plan_albums','not','first_upload_at','is',null],['album_uploads','is','deleted_at',null]]));
 expect(mockSign).toHaveBeenCalledWith('album-media','folder/photo.jpg',7200);expect(tree.root.findByType(PolaroidCard).props).toMatchObject({title:'Our afternoon',coverUri:'https://example.invalid/signed',cacheKey:'folder/photo.jpg',onLongPress:undefined});
});
it.each(['account','unmount'])('retires retry callbacks on %s',async retirement=>{
 mockRead.mockResolvedValueOnce({data:null,error:new Error('offline')});mount();await flush();const retry=action().props.onPress;
 if(retirement==='account'){userId='bob';update();await flush();}else unmount();const count=mockRead.mock.calls.length;act(()=>retry());expect(mockRead).toHaveBeenCalledTimes(count);
});
it('does not let an old account response populate a new account or revive on return',async()=>{
 const old=deferred<any>();mockRead.mockReturnValueOnce(old.promise);mount();userId='bob';update();await flush();expect(words()).toContain('Your albums will live here');old.resolve({data:[],error:null});await flush();expect(client.getQueryData(['albumsGrid','alice'])).toBeUndefined();
 userId='alice';serveAlbum();update();await flush();expect(tree.root.findAllByType(PolaroidCard)).toHaveLength(1);
});
it('keeps the dismissed upload prompt destination and rejects its retired callback',async()=>{
 client.setQueryData(['albumsGrid','alice'],[album]);client.setQueryData(['albumsGrid.dismissedPrompt','alice'],{event_id:'event-1',title:'Sunday together'});mount();await flush();
 const prompt=tree.root.findAll(n=>typeof n.props.onPress==='function'&&n.findAllByType(Text).some(t=>t.props.children==='Sunday together'))[0];
 expect(prompt).toBeDefined();act(()=>prompt.props.onPress());expect(mockPush).toHaveBeenCalledWith('/album/upload/event-1');mockPush.mockClear();const press=prompt.props.onPress;userId='bob';update();act(()=>press());expect(mockPush).not.toHaveBeenCalled();
});
it('keeps archive restricted to empty albums and retires confirmation on account change',async()=>{
 const alert=jest.spyOn(Alert,'alert');client.setQueryData(['albumsGrid','alice'],[{...album,first_upload_at:null}]);mount();await flush();act(()=>tree.root.findByType(PolaroidCard).props.onLongPress());
 const confirm=alert.mock.calls[0][2]!.find(b=>b.text==='Archive')!.onPress!;userId='bob';update();await act(async()=>{await confirm();});expect(mockRpc).not.toHaveBeenCalled();alert.mockRestore();
});
