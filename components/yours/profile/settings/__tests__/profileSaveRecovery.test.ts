import { readOwnProfile, saveOwnProfile } from '../profileOperations';
const initial = { id: 'account-a', first_name_display: 'Alex', profile_photo_url: 'old.jpg', handle: 'alex', neighborhood: null, is_visitor: false, fun_fact: null };
const draft = { name: 'New Alex', handle: 'alex', neighborhood: '', isVisitor: false, funFact: '', photoUrl: 'old.jpg', photoBase64: null as string | null };
let mockRow: any, mockCurrent: boolean;
const mockUser=jest.fn(), mockRefresh=jest.fn(), mockUpload=jest.fn(), mockRead=jest.fn(), mockWrite=jest.fn();
const scope={userId:'account-a',isCurrent:()=>mockCurrent};
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve};};
jest.mock('expo-crypto',()=>({randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}));
jest.mock('../../../../../lib/uploadPhoto',()=>({uploadBase64ToStorage:(...args:any[])=>mockUpload(...args)}));
jest.mock('../../../../../lib/supabase',()=>({supabase:{
 auth:{getUser:()=>mockUser(),refreshSession:()=>mockRefresh()},
 from:()=>{let patch:any=null;const filters:Array<(r:any)=>boolean>=[];const api:any={
 select:()=>api,single:()=>api,maybeSingle:()=>api,
 update:(fields:any)=>{patch=fields;return api},
 eq:(key:string,value:any)=>{filters.push(r=>r[key]===value);return api},
 is:(key:string,value:any)=>{filters.push(r=>r[key]===value);return api},
 then:(yes:any,no:any)=> Promise.resolve(patch?mockWrite(()=>{if(!filters.every(f=>f(mockRow)))return{error:null,count:0};Object.assign(mockRow,patch);return{error:null,count:1}}):mockRead()).then(yes,no),
 };return api;}
}}));
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockRow={...initial};mockCurrent=true;mockUser.mockReset().mockResolvedValue({data:{user:{id:'account-a'}},error:null});mockRefresh.mockReset().mockResolvedValue({data:{session:{user:{id:'account-a'}}},error:null});mockUpload.mockReset().mockResolvedValue('new.jpg');mockRead.mockReset().mockImplementation(async()=>({data:{...mockRow},error:null}));mockWrite.mockReset().mockImplementation(async(commit:any)=>commit());});
afterEach(()=>{jest.clearAllTimers();jest.useRealTimers()});
it('confirms a matching save and preserves the current photo when only text changes',async()=>{mockRow.profile_photo_url='newer-other-device.jpg';const saved=await saveOwnProfile(draft,scope);expect(saved.profile_photo_url).toBe('newer-other-device.jpg');expect(mockRow.first_name_display).toBe('New Alex');});
it.each(['auth','refresh','read','upload'])('bounds a stalled %s before a profile write and ignores its late result',async stage=>{
 const late=deferred<any>();if(stage==='auth')mockUser.mockReturnValueOnce(late.promise);if(stage==='refresh')mockRefresh.mockReturnValueOnce(late.promise);if(stage==='read')mockRead.mockReturnValueOnce(late.promise);if(stage==='upload')mockUpload.mockReturnValueOnce(late.promise);
 let result:any;const saving=saveOwnProfile({...draft,photoBase64:'jpeg'},scope).catch(e=>{result=e});await settle();await jest.advanceTimersByTimeAsync(25000);await saving;expect(result).toBeInstanceOf(Error);expect(mockWrite).not.toHaveBeenCalled();
 late.resolve(stage==='auth'?{data:{user:{id:'account-a'}}}:stage==='refresh'?{data:{session:{user:{id:'account-a'}}}}:stage==='read'?{data:{...mockRow}}:'late.jpg');await settle();expect(mockWrite).not.toHaveBeenCalled();
});
it('recovers a committed write whose response never arrives',async()=>{mockWrite.mockImplementationOnce((commit:any)=>{commit();return new Promise(()=>{})});const saving=saveOwnProfile(draft,scope);await settle();await jest.advanceTimersByTimeAsync(4000);expect((await saving).first_name_display).toBe('New Alex');expect(mockWrite).toHaveBeenCalledTimes(1);});
it('does not claim a stalled uncommitted write succeeded',async()=>{mockWrite.mockReturnValueOnce(new Promise(()=>{}));let error:any;const saving=saveOwnProfile(draft,scope).catch(e=>{error=e});await settle();await jest.advanceTimersByTimeAsync(4000);await saving;expect(error).toBeInstanceOf(Error);expect(mockRow.first_name_display).toBe('Alex');});
it('prevents an old timed-out write replacing a newer confirmed save',async()=>{
 const late=deferred<any>();let oldCommit:any;mockWrite.mockImplementationOnce((commit:any)=>{oldCommit=commit;return late.promise});const first=saveOwnProfile(draft,scope).catch(e=>e);await settle();await jest.advanceTimersByTimeAsync(4000);expect(await first).toBeInstanceOf(Error);
 await saveOwnProfile({...draft,name:'Newest Alex'},scope);late.resolve(oldCommit());await settle();expect(mockRow.first_name_display).toBe('Newest Alex');
});
it('rejects a concurrent edit instead of overwriting it',async()=>{mockWrite.mockImplementationOnce((commit:any)=>{mockRow.fun_fact='Changed elsewhere';return commit()});await expect(saveOwnProfile(draft,scope)).rejects.toThrow();expect(mockRow.first_name_display).toBe('Alex');expect(mockRow.fun_fact).toBe('Changed elsewhere');});
it('does not accept a lost receipt when the fresh row differs from the requested values',async()=>{mockWrite.mockResolvedValueOnce({error:new Error('lost'),count:null});await expect(saveOwnProfile(draft,scope)).rejects.toThrow();});
it('bounds the recovery read after an uncertain write',async()=>{mockWrite.mockReturnValueOnce(new Promise(()=>{}));mockRead.mockResolvedValueOnce({data:{...initial},error:null}).mockReturnValueOnce(new Promise(()=>{}));let result:any;const saving=saveOwnProfile(draft,scope).catch(e=>{result=e});await settle();await jest.advanceTimersByTimeAsync(8000);await saving;expect(result).toBeInstanceOf(Error);});
it('bounds profile loading auth and data reads without returning an empty profile',async()=>{mockUser.mockReturnValueOnce(new Promise(()=>{}));const auth=readOwnProfile(scope).catch(e=>e);await jest.advanceTimersByTimeAsync(4000);expect(await auth).toBeInstanceOf(Error);mockRead.mockReturnValueOnce(new Promise(()=>{}));const read=readOwnProfile(scope).catch(e=>e);await settle();await jest.advanceTimersByTimeAsync(4000);expect(await read).toBeInstanceOf(Error);});
it('never dispatches a save after leaving during preflight',async()=>{const late=deferred<any>();mockRead.mockReturnValueOnce(late.promise);const saving=saveOwnProfile(draft,scope).catch(e=>e);await settle();mockCurrent=false;late.resolve({data:{...initial},error:null});expect(await saving).toBeInstanceOf(Error);expect(mockWrite).not.toHaveBeenCalled();});
it('ignores recovery after leaving during the pending write',async()=>{mockWrite.mockReturnValueOnce(new Promise(()=>{}));const saving=saveOwnProfile(draft,scope).catch(e=>e);await settle();mockCurrent=false;await jest.advanceTimersByTimeAsync(4000);expect(await saving).toBeInstanceOf(Error);expect(mockRead).toHaveBeenCalledTimes(1);});
it('uploads to a unique immutable path and attaches its confirmed URL',async()=>{const saved=await saveOwnProfile({...draft,photoBase64:'jpeg'},scope);expect(mockUpload).toHaveBeenCalledWith('profile-photos','account-a/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg','jpeg',{upsert:false});expect(saved.profile_photo_url).toBe('new.jpg');});
it('does not clear the photo on a missing upload URL',async()=>{mockUpload.mockResolvedValueOnce(null);await expect(saveOwnProfile({...draft,photoBase64:'jpeg'},scope)).rejects.toThrow();expect(mockWrite).not.toHaveBeenCalled();});
