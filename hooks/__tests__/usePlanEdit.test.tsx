import React from 'react';
import { act, create } from 'react-test-renderer';
import { confirmsPlanEdit, usePlanEdit } from '../usePlanEdit';
const mockAuth=jest.fn(),mockRefresh=jest.fn(),mockWrite=jest.fn(),mockRead=jest.fn(),mockPermission=jest.fn(),mockPicker=jest.fn(),mockPrepare=jest.fn(),mockUpload=jest.fn();
let mockBlur:(()=>void)|undefined, mockFocus:(()=>void|(()=>void))|undefined;
jest.mock('expo-router',()=>({useFocusEffect:(cb:any)=>require('react').useEffect(()=>{mockFocus=cb;mockBlur=cb();return()=>mockBlur?.();},[cb])}));
jest.mock('expo-image-picker',()=>({requestMediaLibraryPermissionsAsync:()=>mockPermission(),launchImageLibraryAsync:(...args:any[])=>mockPicker(...args)}));
jest.mock('expo-image-manipulator',()=>({SaveFormat:{JPEG:'jpeg'},manipulateAsync:(...args:any[])=>mockPrepare(...args)}));
jest.mock('../../lib/uploadPhoto',()=>({uploadBase64ToStorage:(...args:any[])=>mockUpload(...args)}));
jest.mock('../../lib/logger',()=>({logError:jest.fn()}));
jest.mock('../../lib/supabase',()=>({supabase:{auth:{getUser:()=>mockAuth(),refreshSession:()=>mockRefresh()},from:(table:string)=>{
 let patch:any,filters:any[]=[];const q:any={update:(v:any)=>{patch=v;return q;},select:()=>q,eq:(...v:any[])=>{filters.push(v);return q;},maybeSingle:()=>patch?mockWrite(table,patch,filters):mockRead(table,filters)};return q;
}}}));
const deferred=()=>{let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{promise,resolve};};
const success=(patch:any={title:'New title'})=>({data:{id:'plan',creator_user_id:'alice',...patch},error:null});
let tree:ReturnType<typeof create>|undefined;
function mount(){
 let current!:ReturnType<typeof usePlanEdit>,epoch=1,ready=true;
 const onSaved=jest.fn(),onPhoto=jest.fn();
 function Harness(){const ownEpoch=epoch;current=usePlanEdit({eventId:'plan',viewerId:'alice',isCurrent:()=>epoch===ownEpoch,canEdit:()=>ready,onSaved,onPhoto});return null;}
 act(()=>{tree=create(<Harness/>);});act(()=>{current.begin();});
 return{get current(){return current;},onSaved,onPhoto,retire:()=>{epoch++;},notReady:()=>{ready=false;},blur:()=>act(()=>mockBlur?.()),focus:()=>act(()=>{mockBlur=mockFocus?.() as any;})};
}
beforeEach(()=>{
 jest.clearAllMocks();mockAuth.mockReset().mockResolvedValue({data:{user:{id:'alice'}},error:null});mockRefresh.mockReset().mockResolvedValue({error:null});
 mockWrite.mockReset().mockImplementation((_table,patch)=>Promise.resolve(success(patch)));mockRead.mockReset().mockResolvedValue(success());
 mockPermission.mockReset().mockResolvedValue({status:'granted'});mockPicker.mockReset().mockResolvedValue({canceled:false,assets:[{uri:'file://chosen'}]});mockPrepare.mockReset().mockResolvedValue({uri:'file://prepared',base64:'photo'});mockUpload.mockReset().mockResolvedValue('https://example.test/new.jpg');
});
afterEach(()=>{if(tree)act(()=>tree!.unmount());tree=undefined;});

it('requires the exact creator, plan and every submitted field in a receipt',()=>{
 expect(confirmsPlanEdit(success().data,'plan','alice',{title:'New title'})).toBe(true);
 for(const row of [null,[],{}, {id:'other',creator_user_id:'alice',title:'New title'}, {id:'plan',creator_user_id:'other',title:'New title'}, {id:'plan',creator_user_id:'alice',title:'Old'}])expect(confirmsPlanEdit(row,'plan','alice',{title:'New title'})).toBe(false);
 expect(confirmsPlanEdit(success({start_time:'2040-09-16T17:00:00+00:00'}).data,'plan','alice',{start_time:'2040-09-16T17:00:00.000Z'})).toBe(true);
});
it('locks synchronously before authentication and rejects overlapping save/photo/exit',async()=>{
 const auth=deferred();mockAuth.mockReturnValueOnce(auth.promise);const h=mount();let work!:Promise<void>;
 act(()=>{work=h.current.save({title:'New title'});void h.current.save({title:'Duplicate'});void h.current.pickPhoto();expect(h.current.close()).toBe(false);expect(h.current.begin()).toBe(false);});
 expect(mockAuth).toHaveBeenCalledTimes(1);expect(mockPermission).not.toHaveBeenCalled();
 await act(async()=>{auth.resolve({data:{user:{id:'alice'}},error:null});await work;});expect(mockWrite).toHaveBeenCalledTimes(1);expect(h.onSaved).toHaveBeenCalledTimes(1);
});
it('checks fresh account before writing',async()=>{mockAuth.mockResolvedValue({data:{user:{id:'bob'}},error:null});const h=mount();await act(async()=>h.current.save({title:'New title'}));expect(mockWrite).not.toHaveBeenCalled();expect(h.current.error).toContain('Your edits are still here');});
it('does not dispatch when the account or permission retires during auth',async()=>{
 for(const retire of ['retire','notReady'] as const){const auth=deferred();mockAuth.mockReturnValueOnce(auth.promise);const h=mount();let work!:Promise<void>;act(()=>{work=h.current.save({title:'New title'});});h[retire]();await act(async()=>{auth.resolve({data:{user:{id:'alice'}},error:null});await work;});expect(mockWrite).not.toHaveBeenCalled();act(()=>tree!.unmount());tree=undefined;}
});
it('allows retry after a proven database rejection',async()=>{mockWrite.mockResolvedValueOnce({data:null,error:{code:'42501'}});const h=mount();await act(async()=>h.current.save({title:'New title'}));expect(h.current.unknown).toBe(false);expect(h.current.error).toBeTruthy();await act(async()=>h.current.save({title:'New title'}));expect(mockWrite).toHaveBeenCalledTimes(2);expect(h.onSaved).toHaveBeenCalledTimes(1);});
it.each([null,[],{id:'other',creator_user_id:'alice',title:'New title'}])('does not claim success or resubmit for a missing or mismatched receipt %p',async(data)=>{mockWrite.mockResolvedValue({data,error:null});const h=mount();await act(async()=>h.current.save({title:'New title'}));expect(h.current.unknown).toBe(true);await act(async()=>h.current.save({title:'Again'}));expect(mockWrite).toHaveBeenCalledTimes(1);expect(h.onSaved).not.toHaveBeenCalled();});
it('reconciles a lost receipt by reading the original patch without writing again',async()=>{mockWrite.mockRejectedValue(new Error('Connection lost'));const h=mount();await act(async()=>h.current.save({title:'New title'}));await act(async()=>h.current.check());expect(mockWrite).toHaveBeenCalledTimes(1);expect(mockRead).toHaveBeenCalledWith('events',[['id','plan'],['creator_user_id','alice']]);expect(h.current.unknown).toBe(false);expect(h.onSaved).toHaveBeenCalledTimes(1);});
it('keeps unknown state through closing/reopening and an inconclusive read',async()=>{mockWrite.mockResolvedValue({data:null,error:null});mockRead.mockResolvedValue(success({title:'Old'}));const h=mount();await act(async()=>h.current.save({title:'New title'}));act(()=>{h.current.close();h.current.begin();});await act(async()=>h.current.check());expect(h.current.unknown).toBe(true);expect(h.current.error).toContain('still can’t confirm');expect(h.onSaved).not.toHaveBeenCalled();});
it('does not close or report into a new visit after an old save completes',async()=>{const response=deferred();mockWrite.mockReturnValue(response.promise);const h=mount();let work!:Promise<void>;await act(async()=>{work=h.current.save({title:'New title'});});h.blur();h.focus();await act(async()=>{response.resolve(success());await work;});expect(h.onSaved).not.toHaveBeenCalled();act(()=>{expect(h.current.begin()).toBe(true);});});
it('retains uncertainty from a save that lost its receipt after blur',async()=>{const response=deferred();mockWrite.mockReturnValue(response.promise);const h=mount();let work!:Promise<void>;await act(async()=>{work=h.current.save({title:'New title'});});h.blur();h.focus();await act(async()=>{response.resolve({data:null,error:null});await work;});act(()=>{h.current.begin();});expect(h.current.canChange()).toBe(false);await act(async()=>h.current.check());expect(h.onSaved).toHaveBeenCalledTimes(1);});
it('locks from photo permission through upload and only publishes the uploaded URL',async()=>{const permission=deferred();mockPermission.mockReturnValueOnce(permission.promise);const h=mount();let work!:Promise<void>;act(()=>{work=h.current.pickPhoto();void h.current.pickPhoto();void h.current.save({title:'New title'});expect(h.current.close()).toBe(false);});expect(mockPermission).toHaveBeenCalledTimes(1);expect(mockWrite).not.toHaveBeenCalled();expect(h.onPhoto).not.toHaveBeenCalled();await act(async()=>{permission.resolve({status:'granted'});await work;});expect(mockUpload).toHaveBeenCalledWith('event-images',expect.stringMatching(/^alice\/\d+\.jpg$/),'photo');expect(h.onPhoto).toHaveBeenCalledTimes(1);expect(h.onPhoto).toHaveBeenCalledWith('https://example.test/new.jpg');});
it.each(['permission','picker','prepare','upload'])('preserves the old photo when %s fails',async(stage)=>{({permission:mockPermission,picker:mockPicker,prepare:mockPrepare,upload:mockUpload}[stage]!).mockRejectedValueOnce(new Error('Failed'));const h=mount();await act(async()=>h.current.pickPhoto());expect(h.onPhoto).not.toHaveBeenCalled();expect(h.current.error).toBeTruthy();expect(h.current.isBusy).toBe(false);});
it('treats cancellation as unchanged with no error',async()=>{mockPicker.mockResolvedValue({canceled:true});const h=mount();await act(async()=>h.current.pickPhoto());expect(h.onPhoto).not.toHaveBeenCalled();expect(h.current.error).toBeNull();expect(mockUpload).not.toHaveBeenCalled();});
it('does not upload if authentication changes during refresh',async()=>{mockAuth.mockResolvedValueOnce({data:{user:{id:'alice'}},error:null}).mockResolvedValueOnce({data:{user:{id:'bob'}},error:null});const h=mount();await act(async()=>h.current.pickPhoto());expect(mockUpload).not.toHaveBeenCalled();expect(h.onPhoto).not.toHaveBeenCalled();});
it('ignores a retired picker and never starts preparation',async()=>{const picker=deferred();mockPicker.mockReturnValueOnce(picker.promise);const h=mount();let work!:Promise<void>;await act(async()=>{work=h.current.pickPhoto();});h.retire();await act(async()=>{picker.resolve({canceled:false,assets:[{uri:'file://late'}]});await work;});expect(mockPrepare).not.toHaveBeenCalled();expect(mockUpload).not.toHaveBeenCalled();});
it('does not apply a late upload after leaving the editor',async()=>{const upload=deferred();mockUpload.mockReturnValueOnce(upload.promise);const h=mount();let work!:Promise<void>;await act(async()=>{work=h.current.pickPhoto();});h.blur();h.focus();await act(async()=>{upload.resolve('https://example.test/late.jpg');await work;});expect(h.onPhoto).not.toHaveBeenCalled();act(()=>{expect(h.current.begin()).toBe(true);});});

it('restores the unknown state when focus returns after the response arrived off-screen',async()=>{const response=deferred();mockWrite.mockReturnValueOnce(response.promise);const h=mount();let work!:Promise<void>;await act(async()=>{work=h.current.save({title:'New title'});});h.blur();await act(async()=>{response.resolve({data:null,error:null});await work;});h.focus();act(()=>{h.current.begin();});expect(h.current.unknown).toBe(true);expect(h.current.canChange()).toBe(false);});

it.each(['owner', 'refresh', 'owner-after-refresh', 'upload'] as const)('releases an edit-photo %s stall without changing the existing photo or applying a late result', async stage => {
  jest.useFakeTimers();
  try {
    const f = mount(), stalled = deferred();
    const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
    if (stage === 'upload') mockUpload.mockReturnValueOnce(stalled.promise);
    else if (stage === 'refresh') mockRefresh.mockReturnValueOnce(stalled.promise);
    else { if (stage === 'owner-after-refresh') mockAuth.mockResolvedValueOnce({ data: { user: { id: 'alice' } }, error: null }); mockAuth.mockReturnValueOnce(stalled.promise); }
    let settled = false;
    act(() => { void f.current.pickPhoto().then(() => { settled = true; }); }); await flush();
    await act(async () => { jest.advanceTimersByTime(stage === 'upload' ? 30_000 : 12_000); }); await flush();
    expect(settled).toBe(true); expect(f.current.isPhotoPending).toBe(false);
    expect(f.current.error).toContain('upload this photo'); expect(f.onPhoto).not.toHaveBeenCalled();
    expect(f.current.canChange()).toBe(true);
    await act(async () => { await f.current.pickPhoto(); }); await flush();
    expect(f.onPhoto).toHaveBeenCalledTimes(1);
    const writes = mockUpload.mock.calls.length;
    await act(async () => { stalled.resolve(stage === 'upload' ? 'https://example.test/retired.jpg' : { data: { user: { id: 'alice' } }, error: null }); }); await flush();
    expect(mockUpload).toHaveBeenCalledTimes(writes); expect(f.onPhoto).toHaveBeenCalledTimes(1);
    expect(mockWrite).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
