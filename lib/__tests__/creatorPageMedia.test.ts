import AsyncStorage from '@react-native-async-storage/async-storage';
const mockUser=jest.fn(),mockFrom=jest.fn(),mockRpc=jest.fn(),mockUpload=jest.fn(),mockDownload=jest.fn(),mockSession=jest.fn();
const mockPermission=jest.fn(),mockPicker=jest.fn(),mockManipulate=jest.fn(),mockRead=jest.fn(),mockCopy=jest.fn(),mockDelete=jest.fn();
jest.mock('../supabase',()=>({SUPABASE_URL:'http://127.0.0.1:55321',SUPABASE_ANON_KEY:'local-anon',supabase:{auth:{getUser:()=>mockUser(),getSession:()=>mockSession()},from:(...a:unknown[])=>mockFrom(...a),rpc:(...a:unknown[])=>mockRpc(...a),storage:{from:()=>({upload:(...a:unknown[])=>mockUpload(...a),download:(...a:unknown[])=>mockDownload(...a)})}}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '33333333-3333-4333-8333-333333333333',CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:async(_:unknown,value:string)=>require('crypto').createHash('sha256').update(value).digest('hex')}));
jest.mock('expo-image-picker',()=>({requestMediaLibraryPermissionsAsync:()=>mockPermission(),launchImageLibraryAsync:()=>mockPicker()}));
jest.mock('expo-image-manipulator',()=>({SaveFormat:{JPEG:'jpeg'},manipulateAsync:(...a:unknown[])=>mockManipulate(...a)}));
jest.mock('expo-file-system/legacy',()=>({documentDirectory:'file:///documents/',EncodingType:{Base64:'base64'},makeDirectoryAsync:async()=>{},copyAsync:(...a:unknown[])=>mockCopy(...a),readAsStringAsync:(...a:unknown[])=>mockRead(...a),deleteAsync:(...a:unknown[])=>mockDelete(...a)}));
import { pageCoverActionPending,pickPageCover,readPageCoverAttempt,uploadPageCover,checkPageCover,clearPageCoverAttempt,resetUnreadablePageCoverAttempt,loadPageCoverSource } from '../creatorPageMedia';
const userId='11111111-1111-4111-8111-111111111111',pageId='22222222-2222-4222-8222-222222222222';
const scope={userId,isCurrent:()=>true},base64='AQIDBA==';
const mediaId='33333333-3333-4333-8333-333333333333';
const media=(ready=false)=>({id:mediaId,page_id:pageId,object_name:`${pageId}/${mediaId}.jpg`,byte_size:4,mime_type:'image/jpeg',created_by:userId,ready_at:ready?'2026-09-14T00:00:00Z':null});
const q=(data:unknown)=>{const v:any={};for(const k of ['select','eq','maybeSingle'])v[k]=()=>v;v.then=(r:any)=>Promise.resolve({data,error:null}).then(r);return v;};
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();mockUser.mockResolvedValue({data:{user:{id:userId}},error:null});mockSession.mockResolvedValue({data:{session:{user:{id:userId},access_token:'private-test-token'}},error:null});mockPermission.mockResolvedValue({granted:true});mockPicker.mockResolvedValue({canceled:false,assets:[{uri:'file:///picked.jpg'}]});mockManipulate.mockResolvedValue({uri:'file:///prepared.jpg',base64});mockRead.mockResolvedValue(base64);mockCopy.mockResolvedValue(undefined);mockDelete.mockResolvedValue(undefined);mockFrom.mockImplementation(()=>q(null));mockUpload.mockResolvedValue({data:{},error:null});mockRpc.mockImplementation(async(name:string)=>({data:media(name==='complete_creator_page_media'),error:null}));mockDownload.mockResolvedValue({data:{arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer},error:null});});
it('cancel and denied permission never start a remote write or save a photo attempt',async()=>{mockPermission.mockResolvedValueOnce({granted:false});await expect(pickPageCover(pageId,scope)).rejects.toThrow('Allow photo access');expect(mockPicker).not.toHaveBeenCalled();mockPicker.mockResolvedValueOnce({canceled:true});expect(await pickPageCover(pageId,scope)).toBeNull();expect(await readPageCoverAttempt(pageId,scope)).toBeNull();expect(mockRpc).not.toHaveBeenCalled();});
it('persists the selected immutable identity and app-owned file before remote writes',async()=>{const a=await pickPageCover(pageId,scope);expect(a).toMatchObject({pageId,mediaId,byteSize:4});expect(await readPageCoverAttempt(pageId,scope)).toEqual(a);expect(mockCopy).toHaveBeenCalledWith({from:'file:///prepared.jpg',to:a!.fileUri});expect(mockRpc).not.toHaveBeenCalled();await expect(pickPageCover(pageId,scope)).rejects.toThrow('Finish the saved photo');});
it('journal failure stops before reservation, retaining no invented success',async()=>{jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Disk full'));await expect(pickPageCover(pageId,scope)).rejects.toThrow('Disk full');expect(mockRpc).not.toHaveBeenCalled();});
it('unknown upload outcome retains the original attempt and does not retry automatically',async()=>{const a=(await pickPageCover(pageId,scope))!;mockUpload.mockResolvedValueOnce({error:{statusCode:'503'}});await expect(uploadPageCover(a,scope)).rejects.toMatchObject({statusCode:'503'});expect(mockUpload).toHaveBeenCalledTimes(1);expect(mockRpc).toHaveBeenCalledTimes(1);expect(await readPageCoverAttempt(pageId,scope)).toEqual(a);});
it('same-ID retry verifies a conflict against the exact bytes before completing',async()=>{const a=(await pickPageCover(pageId,scope))!;mockUpload.mockResolvedValueOnce({error:{statusCode:'409'}});await expect(uploadPageCover(a,scope)).resolves.toMatchObject({id:mediaId,ready_at:expect.any(String)});expect(mockDownload).toHaveBeenCalledWith(media().object_name);expect(mockUpload.mock.calls[0][2]).toEqual({contentType:'image/jpeg',upsert:false,cacheControl:'0'});expect(mockRpc.mock.calls.map(c=>c[0])).toEqual(['reserve_creator_page_media','complete_creator_page_media']);});
it('rejects a conflict containing different bytes without completing or replacing it',async()=>{const a=(await pickPageCover(pageId,scope))!;mockUpload.mockResolvedValueOnce({error:{statusCode:'409'}});mockDownload.mockResolvedValueOnce({data:{arrayBuffer:async()=>new Uint8Array([4,3,2,1]).buffer},error:null});await expect(uploadPageCover(a,scope)).rejects.toThrow('does not match');expect(mockRpc).toHaveBeenCalledTimes(1);expect(await readPageCoverAttempt(pageId,scope)).toEqual(a);});
it('read-only recovery checks a ready receipt but never uploads or calls a mutation RPC',async()=>{const a=(await pickPageCover(pageId,scope))!;expect(await checkPageCover(a,scope)).toBeNull();mockFrom.mockImplementation(()=>q(media(true)));expect(await checkPageCover(a,scope)).toMatchObject({id:mediaId});expect(mockUpload).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();});
it('uses native FileReader when Blob has no arrayBuffer',async()=>{const a=(await pickPageCover(pageId,scope))!;mockFrom.mockImplementation(()=>q(media(true)));mockDownload.mockResolvedValueOnce({data:{size:4},error:null});const original=global.FileReader;global.FileReader=class{result=`data:image/jpeg;base64,${base64}`;onload:any;readAsDataURL(){this.onload();}} as any;try{expect(await checkPageCover(a,scope)).toMatchObject({id:mediaId});}finally{global.FileReader=original;}});
it('rejects changed local bytes before any reservation',async()=>{const a=(await pickPageCover(pageId,scope))!;mockRead.mockResolvedValueOnce('BAQDBA==');await expect(uploadPageCover(a,scope)).rejects.toThrow('selected photo changed');expect(mockRpc).not.toHaveBeenCalled();});
it('rejects a foreign path or wrong account without remote writes',async()=>{const a=(await pickPageCover(pageId,scope))!;await expect(uploadPageCover({...a,fileUri:'file:///other.jpg'},scope)).rejects.toThrow('invalid');mockUser.mockResolvedValueOnce({data:{user:{id:'other'}},error:null});await expect(uploadPageCover(a,scope)).rejects.toThrow();expect(mockRpc).not.toHaveBeenCalled();});
it('retires late permission completion before it can open the picker',async()=>{let active=true;mockPermission.mockImplementationOnce(async()=>{active=false;return{granted:true};});await expect(pickPageCover(pageId,{userId,isCurrent:()=>active})).rejects.toThrow();expect(mockPicker).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();});
it('serializes simultaneous picker visits for the same account and page',async()=>{let resolve:any;mockPermission.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=pickPageCover(pageId,scope);await Promise.resolve();await Promise.resolve();await expect(pickPageCover(pageId,scope)).rejects.toThrow('still finishing');while(!resolve)await Promise.resolve();resolve({granted:false});await expect(pending).rejects.toThrow('Allow photo access');});
it('clears only the saved local file and marker, never deleting a remote review image',async()=>{const a=(await pickPageCover(pageId,scope))!;await clearPageCoverAttempt(a,scope);expect(await readPageCoverAttempt(pageId,scope)).toBeNull();expect(mockDelete).toHaveBeenCalledWith(a.fileUri,{idempotent:true});expect(mockRpc).not.toHaveBeenCalled();});
it('returns a private authenticated source only after checking current identity and media',async()=>{mockFrom.mockImplementation(()=>q(media(true)));const result=await loadPageCoverSource(pageId,mediaId,scope);expect(result.uri).toContain('/object/authenticated/creator-page-media/');expect(result.headers.Authorization).toBe('Bearer private-test-token');mockSession.mockResolvedValueOnce({data:{session:{user:{id:'other'},access_token:'other'}},error:null});await expect(loadPageCoverSource(pageId,mediaId,scope)).rejects.toThrow();});

it('resets unreadable metadata without following its file path or altering remote media',async()=>{
 await AsyncStorage.setItem(`creator-page-cover:v1:${userId}:${pageId}`,JSON.stringify({fileUri:'file:///not-app-owned'}));
 await expect(readPageCoverAttempt(pageId,scope)).rejects.toThrow();await resetUnreadablePageCoverAttempt(pageId,scope);
 expect(await readPageCoverAttempt(pageId,scope)).toBeNull();expect(mockDelete).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();
});
it('does not reset a valid recoverable selection as corrupt metadata',async()=>{
 const a=await pickPageCover(pageId,scope);await expect(resetUnreadablePageCoverAttempt(pageId,scope)).rejects.toThrow('can be recovered');
 expect(await readPageCoverAttempt(pageId,scope)).toEqual(a);
});

it('reports only the interactive picker interval and retains ownership until selection settles',async()=>{
 let resolve!:(value:any)=>void;mockPicker.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const changed=jest.fn();
 const pending=pickPageCover(pageId,scope,changed);while(!resolve)await Promise.resolve();
 expect(changed.mock.calls).toEqual([[true]]);await expect(pickPageCover(pageId,scope)).rejects.toThrow('still finishing');
 resolve({canceled:true});expect(await pending).toBeNull();expect(changed.mock.calls).toEqual([[true],[false]]);expect(mockCopy).not.toHaveBeenCalled();
});
it('closes picker interval on errors and does not open it for denied permission',async()=>{
 const changed=jest.fn();mockPermission.mockResolvedValueOnce({granted:false});await expect(pickPageCover(pageId,scope,changed)).rejects.toThrow();expect(changed).not.toHaveBeenCalled();
 mockPicker.mockRejectedValueOnce(Error('picker unavailable'));await expect(pickPageCover(pageId,scope,changed)).rejects.toThrow('picker unavailable');expect(changed.mock.calls).toEqual([[true],[false]]);
});

it('stalled reservation returns the original photo attempt without issuing an upload',async()=>{
 jest.useFakeTimers();try{const attempt=(await pickPageCover(pageId,scope))!;mockRpc.mockReturnValueOnce(new Promise(()=>{}));const pending=uploadPageCover(attempt,scope);const failed=expect(pending).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(25000);await failed;expect(await readPageCoverAttempt(pageId,scope)).toEqual(attempt);expect(mockUpload).not.toHaveBeenCalled();}finally{jest.useRealTimers();}
});
it('stalled upload keeps its immutable identity and never auto-finalizes from a late response',async()=>{
 jest.useFakeTimers();try{const attempt=(await pickPageCover(pageId,scope))!;let finish!:(v:any)=>void;mockUpload.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));const pending=uploadPageCover(attempt,scope);const failed=expect(pending).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(120000);await failed;finish({data:{},error:null});await Promise.resolve();expect(await readPageCoverAttempt(pageId,scope)).toEqual(attempt);expect(mockRpc.mock.calls.map(c=>c[0])).toEqual(['reserve_creator_page_media']);}finally{jest.useRealTimers();}
});

it('keeps an empty stored photo marker as unreadable recovery until explicitly reset',async()=>{
 const key=`creator-page-cover:v1:${userId}:${pageId}`;await AsyncStorage.setItem(key,'');
 // The bundled storage mock coerces empty strings to null; model the native raw value explicitly.
 jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('');
 await expect(readPageCoverAttempt(pageId,scope)).rejects.toThrow();
 expect(await AsyncStorage.getAllKeys()).toContain(key);expect(mockRpc).not.toHaveBeenCalled();
 jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('');
 // Its remove mock also skips falsy values; retain native removal semantics for this case.
 jest.mocked(AsyncStorage.removeItem).mockImplementationOnce(async storageKey=>{
  delete (AsyncStorage as typeof AsyncStorage & {__INTERNAL_MOCK_STORAGE__:Record<string,string>}).__INTERNAL_MOCK_STORAGE__[storageKey];
 });
 await resetUnreadablePageCoverAttempt(pageId,scope);
 expect(AsyncStorage.removeItem).toHaveBeenCalledWith(key);
 expect(await AsyncStorage.getAllKeys()).not.toContain(key);expect(await AsyncStorage.getItem(key)).toBeNull();expect(mockDelete).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();
});

it('exposes pending marker-write ownership across visit retirement only to the same account and page',async()=>{
 const write=jest.mocked(AsyncStorage.setItem).getMockImplementation()!;let finish!:()=>void,active=true;
 jest.mocked(AsyncStorage.setItem).mockImplementationOnce((key,value)=>new Promise<void>((resolve,reject)=>{finish=()=>{void Promise.resolve(write(key,value)).then(()=>resolve(),reject);};}));
 const pending=pickPageCover(pageId,{userId,isCurrent:()=>active});const rejected=expect(pending).rejects.toThrow();
 for(let step=0;step<100&&!finish;step++)await Promise.resolve();expect(finish).toBeDefined();
 active=false;expect(pageCoverActionPending(pageId,scope)).toBe(true);
 expect(pageCoverActionPending('another-page',scope)).toBe(false);
 expect(pageCoverActionPending(pageId,{...scope,userId:'another-account'})).toBe(false);
 expect(await AsyncStorage.getItem(`creator-page-cover:v1:${userId}:${pageId}`)).toBeNull();
 finish();await rejected;
 expect(pageCoverActionPending(pageId,scope)).toBe(false);
 expect(await readPageCoverAttempt(pageId,scope)).toMatchObject({pageId,mediaId});expect(mockRpc).not.toHaveBeenCalled();
});
