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
 let patch:any,filters:any[]=[];const q:any={update:(v:any)=>{patch=v;return q;},select:()=>q,eq:(...v:any[])=>{filters.push(v);return q;},is:(...v:any[])=>{filters.push(v);return q;},maybeSingle:()=>patch?mockWrite(table,patch,filters):mockRead(table,filters)};return q;
}}}));
const deferred=()=>{let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{promise,resolve};};
const originalVersion='2026-11-06T01:00:00.123456Z', savedVersion='2026-11-06T01:00:00.123457Z';
const success=(patch:any={title:'New title'})=>({data:{id:'plan',creator_user_id:'alice',updated_at:savedVersion,...patch},error:null});
let tree:ReturnType<typeof create>|undefined;
function mount(){
 let current!:Omit<ReturnType<typeof usePlanEdit>,'save'> & {save:(patch:Record<string,any>,version?:string|null)=>Promise<void>},epoch=1,ready=true;
 const onSaved=jest.fn(),onPhoto=jest.fn();
 function Harness(){const ownEpoch=epoch;const edit=usePlanEdit({eventId:'plan',viewerId:'alice',isCurrent:()=>epoch===ownEpoch,canEdit:()=>ready,onSaved,onPhoto});current={...edit,save:(patch,version=originalVersion)=>edit.save(patch,version)};return null;}
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
it.each([undefined,[],{id:'other',creator_user_id:'alice',title:'New title'}])('does not claim success or resubmit for a missing or mismatched receipt %p',async(data)=>{mockWrite.mockResolvedValue({data,error:null});const h=mount();await act(async()=>h.current.save({title:'New title'}));expect(h.current.unknown).toBe(true);await act(async()=>h.current.save({title:'Again'}));expect(mockWrite).toHaveBeenCalledTimes(1);expect(h.onSaved).not.toHaveBeenCalled();});
it('reconciles a lost receipt by reading the original patch without writing again',async()=>{mockWrite.mockRejectedValue(new Error('Connection lost'));const h=mount();await act(async()=>h.current.save({title:'New title'}));await act(async()=>h.current.check());expect(mockWrite).toHaveBeenCalledTimes(1);expect(mockRead).toHaveBeenCalledWith('events',[['id','plan'],['creator_user_id','alice']]);expect(h.current.unknown).toBe(false);expect(h.onSaved).toHaveBeenCalledTimes(1);});
it('keeps unknown state through closing/reopening and an inconclusive read',async()=>{mockWrite.mockResolvedValue({data:undefined,error:null});mockRead.mockResolvedValue(success({title:'Old',updated_at:originalVersion}));const h=mount();await act(async()=>h.current.save({title:'New title'}));act(()=>{h.current.close();h.current.begin();});await act(async()=>h.current.check());expect(h.current.unknown).toBe(true);expect(h.current.error).toContain('still can’t confirm');expect(h.onSaved).not.toHaveBeenCalled();});
it('does not close or report into a new visit after an old save completes',async()=>{const response=deferred();mockWrite.mockReturnValue(response.promise);const h=mount();let work!:Promise<void>;await act(async()=>{work=h.current.save({title:'New title'});});h.blur();h.focus();await act(async()=>{response.resolve(success());await work;});expect(h.onSaved).not.toHaveBeenCalled();act(()=>{expect(h.current.begin()).toBe(true);});});
it('retains uncertainty from a save that lost its receipt after blur',async()=>{const response=deferred();mockWrite.mockReturnValue(response.promise);const h=mount();let work!:Promise<void>;await act(async()=>{work=h.current.save({title:'New title'});});h.blur();h.focus();await act(async()=>{response.resolve({data:undefined,error:null});await work;});act(()=>{h.current.begin();});expect(h.current.canChange()).toBe(false);await act(async()=>h.current.check());expect(h.onSaved).toHaveBeenCalledTimes(1);});
it('locks from the photo picker through upload and only publishes the uploaded URL',async()=>{const picker=deferred();mockPicker.mockReturnValueOnce(picker.promise);const h=mount();let work!:Promise<void>;act(()=>{work=h.current.pickPhoto();void h.current.pickPhoto();void h.current.save({title:'New title'});expect(h.current.close()).toBe(false);});expect(mockPicker).toHaveBeenCalledTimes(1);expect(mockPermission).not.toHaveBeenCalled();expect(mockWrite).not.toHaveBeenCalled();expect(h.onPhoto).not.toHaveBeenCalled();await act(async()=>{picker.resolve({canceled:false,assets:[{uri:'file://chosen'}]});await work;});expect(mockUpload).toHaveBeenCalledWith('event-images',expect.stringMatching(/^alice\/\d+\.jpg$/),'photo');expect(h.onPhoto).toHaveBeenCalledTimes(1);expect(h.onPhoto).toHaveBeenCalledWith('https://example.test/new.jpg');});
it.each(['picker','prepare','upload'])('preserves the old photo when %s fails',async(stage)=>{({picker:mockPicker,prepare:mockPrepare,upload:mockUpload}[stage]!).mockRejectedValueOnce(new Error('Failed'));const h=mount();await act(async()=>h.current.pickPhoto());expect(h.onPhoto).not.toHaveBeenCalled();expect(h.current.error).toBeTruthy();expect(h.current.isBusy).toBe(false);});
it('treats cancellation as unchanged with no error',async()=>{mockPicker.mockResolvedValue({canceled:true});const h=mount();await act(async()=>h.current.pickPhoto());expect(h.onPhoto).not.toHaveBeenCalled();expect(h.current.error).toBeNull();expect(mockUpload).not.toHaveBeenCalled();});
it('does not upload if authentication changes during refresh',async()=>{mockAuth.mockResolvedValueOnce({data:{user:{id:'alice'}},error:null}).mockResolvedValueOnce({data:{user:{id:'bob'}},error:null});const h=mount();await act(async()=>h.current.pickPhoto());expect(mockUpload).not.toHaveBeenCalled();expect(h.onPhoto).not.toHaveBeenCalled();});
it('ignores a retired picker and never starts preparation',async()=>{const picker=deferred();mockPicker.mockReturnValueOnce(picker.promise);const h=mount();let work!:Promise<void>;await act(async()=>{work=h.current.pickPhoto();});h.retire();await act(async()=>{picker.resolve({canceled:false,assets:[{uri:'file://late'}]});await work;});expect(mockPrepare).not.toHaveBeenCalled();expect(mockUpload).not.toHaveBeenCalled();});
it('does not apply a late upload after leaving the editor',async()=>{const upload=deferred();mockUpload.mockReturnValueOnce(upload.promise);const h=mount();let work!:Promise<void>;await act(async()=>{work=h.current.pickPhoto();});h.blur();h.focus();await act(async()=>{upload.resolve('https://example.test/late.jpg');await work;});expect(h.onPhoto).not.toHaveBeenCalled();act(()=>{expect(h.current.begin()).toBe(true);});});

it('restores the unknown state when focus returns after the response arrived off-screen',async()=>{const response=deferred();mockWrite.mockReturnValueOnce(response.promise);const h=mount();let work!:Promise<void>;await act(async()=>{work=h.current.save({title:'New title'});});h.blur();await act(async()=>{response.resolve({data:undefined,error:null});await work;});h.focus();act(()=>{h.current.begin();});expect(h.current.unknown).toBe(true);expect(h.current.canChange()).toBe(false);});

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

describe('photo preparation recovery', () => {
  const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('releases stalled preparation and ignores its late result while a retry is pending', async () => {
    const old = deferred(), retry = deferred();
    mockPrepare.mockReturnValueOnce(old.promise).mockReturnValueOnce(retry.promise);
    const h = mount();
    act(() => { void h.current.pickPhoto(); }); await flush();
    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(h.current.isBusy).toBe(false);
    expect(h.current.error).toContain('Couldn’t prepare this photo');
    expect(h.onPhoto).not.toHaveBeenCalled(); expect(mockAuth).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled(); expect(mockWrite).not.toHaveBeenCalled();
    act(() => { expect(h.current.close()).toBe(true); expect(h.current.begin()).toBe(true); void h.current.pickPhoto(); }); await flush();
    await act(async () => { old.resolve({ base64: 'old-photo' }); }); await flush();
    expect(h.current.isBusy).toBe(true); expect(h.current.close()).toBe(false);
    expect(mockUpload).not.toHaveBeenCalled(); expect(h.onPhoto).not.toHaveBeenCalled();
    await act(async () => { retry.resolve({ base64: 'retry-photo' }); }); await flush();
    expect(h.current.isBusy).toBe(false); expect(h.current.error).toBeNull();
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][2]).toBe('retry-photo');
    expect(h.onPhoto).toHaveBeenCalledTimes(1); expect(mockWrite).not.toHaveBeenCalled();
  });

  it('releases an off-screen preparation timeout without applying results to a reopened editor', async () => {
    const old = deferred(); mockPrepare.mockReturnValueOnce(old.promise); const h = mount();
    act(() => { void h.current.pickPhoto(); }); await flush(); h.blur();
    await act(async () => { jest.advanceTimersByTime(30_000); }); h.focus();
    act(() => { expect(h.current.begin()).toBe(true); });
    expect(h.current.error).toBeNull(); expect(h.current.isBusy).toBe(false);
    await act(async () => { old.resolve({ base64: 'retired-photo' }); }); await flush();
    expect(mockAuth).not.toHaveBeenCalled(); expect(mockUpload).not.toHaveBeenCalled();
    expect(h.onPhoto).not.toHaveBeenCalled(); expect(h.current.canChange()).toBe(true);
  });

  it('does not time out time spent choosing a photo', async () => {
    const picker = deferred(); mockPicker.mockReturnValueOnce(picker.promise); const h = mount();
    act(() => { void h.current.pickPhoto(); }); await flush();
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(h.current.isPhotoPending).toBe(true); expect(mockPrepare).not.toHaveBeenCalled();
    await act(async () => { picker.resolve({ canceled: true }); }); await flush();
    expect(h.current.isBusy).toBe(false); expect(h.current.error).toBeNull();
  });
});

describe('stalled plan saves and reconciliation', () => {
  const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
  const advance = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); await flush(); };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('releases stalled authentication without writing and ignores it during a retry', async () => {
    const oldAuth = deferred(), retryAuth = deferred();
    mockAuth.mockReturnValueOnce(oldAuth.promise).mockReturnValueOnce(retryAuth.promise);
    const h = mount();
    act(() => { void h.current.save({ title: 'Original draft' }); });
    await advance(12_000);
    expect(h.current.isBusy).toBe(false); expect(h.current.unknown).toBe(false);
    expect(h.current.error).toContain('Your edits are still here'); expect(mockWrite).not.toHaveBeenCalled();
    act(() => { void h.current.save({ title: 'Retry draft' }); });
    await act(async () => { oldAuth.resolve({ data: { user: { id: 'alice' } }, error: null }); });
    expect(h.current.isBusy).toBe(true); expect(mockWrite).not.toHaveBeenCalled();
    await act(async () => { retryAuth.resolve({ data: { user: { id: 'alice' } }, error: null }); });
    expect(mockWrite).toHaveBeenCalledTimes(1); expect(mockWrite.mock.calls[0][1]).toEqual({ title: 'Retry draft' });
    expect(h.onSaved).toHaveBeenCalledTimes(1);
  });

  it('turns a stalled dispatched write into read-only checking and ignores the late receipt', async () => {
    const write = deferred(); mockWrite.mockReturnValueOnce(write.promise);
    const h = mount();
    act(() => { void h.current.save({ title: 'New title' }); }); await flush();
    await advance(15_000);
    expect(h.current.isBusy).toBe(false); expect(h.current.unknown).toBe(true);
    expect(h.current.canChange()).toBe(false); expect(h.onSaved).not.toHaveBeenCalled();
    act(() => { expect(h.current.close()).toBe(true); expect(h.current.begin()).toBe(true); });
    await act(async () => { await h.current.save({ title: 'Duplicate' }); await h.current.pickPhoto(); });
    expect(mockWrite).toHaveBeenCalledTimes(1); expect(mockPicker).not.toHaveBeenCalled();
    await act(async () => { write.resolve(success()); });
    expect(h.current.unknown).toBe(true); expect(h.onSaved).not.toHaveBeenCalled();
    await act(async () => { await h.current.check(); });
    expect(mockWrite).toHaveBeenCalledTimes(1); expect(h.current.unknown).toBe(false);
    expect(h.onSaved).toHaveBeenCalledTimes(1);
  });

  it.each(['auth', 'read'])('releases a stalled reconciliation %s and keeps retry read-only', async stage => {
    mockWrite.mockResolvedValueOnce({ data: undefined, error: null });
    const h = mount(); await act(async () => { await h.current.save({ title: 'New title' }); });
    const stalled = deferred();
    if (stage === 'auth') mockAuth.mockReturnValueOnce(stalled.promise);
    else mockRead.mockReturnValueOnce(stalled.promise);
    act(() => { void h.current.check(); }); await flush();
    await advance(stage === 'auth' ? 12_000 : 15_000);
    expect(h.current.isBusy).toBe(false); expect(h.current.unknown).toBe(true);
    expect(h.current.error).toContain('still can’t confirm');
    await act(async () => { await h.current.check(); });
    expect(h.onSaved).toHaveBeenCalledTimes(1); expect(mockWrite).toHaveBeenCalledTimes(1);
    const reads = mockRead.mock.calls.length;
    await act(async () => { stalled.resolve(stage === 'auth' ? { data: { user: { id: 'alice' } }, error: null } : success()); });
    expect(mockRead).toHaveBeenCalledTimes(reads); expect(h.onSaved).toHaveBeenCalledTimes(1);
  });

  it('preserves an unresolved write across blur and timeout without closing a later editor', async () => {
    const write = deferred(); mockWrite.mockReturnValueOnce(write.promise);
    const h = mount(); act(() => { void h.current.save({ title: 'New title' }); }); await flush();
    h.blur(); await advance(15_000); h.focus();
    act(() => { expect(h.current.begin()).toBe(true); });
    expect(h.current.unknown).toBe(true); expect(h.current.canChange()).toBe(false);
    await act(async () => { write.resolve(success()); });
    expect(h.onSaved).not.toHaveBeenCalled(); expect(h.current.unknown).toBe(true);
  });
});

it('chooses a plan photo even when broad library access is denied', async () => {
  mockPermission.mockResolvedValue({status:'denied',canAskAgain:false});
  const h=mount();
  await act(async()=>h.current.pickPhoto());
  expect(mockPermission).not.toHaveBeenCalled();
  expect(mockPicker).toHaveBeenCalledWith(expect.objectContaining({mediaTypes:['images'],allowsEditing:true,aspect:[16,10]}));
  expect(h.current.error).toBeNull();
  expect(h.onPhoto).toHaveBeenCalledWith('https://example.test/new.jpg');
});

it('does not let an unresolved save from a retired route overwrite a newer confirmed edit',async()=>{
 jest.useFakeTimers();try { let title='Original', version=originalVersion;let finishOld!:()=>void;
 const commit=(patch:any,filters:any[])=>{if(!filters.some(([key,value])=>key==='updated_at'&&value===version))return {data:null,error:null};title=patch.title;version=savedVersion;return success(patch);};
 mockWrite.mockImplementation((_table,patch,filters)=>Promise.resolve(commit(patch,filters)));
 mockWrite.mockImplementationOnce((_table,patch,filters)=>new Promise(resolve=>{finishOld=()=>resolve(commit(patch,filters));}));
 const old=mount();let pending!:Promise<void>;act(()=>{pending=old.current.save({title:'Earlier edit'});});
 await act(async()=>{await jest.advanceTimersByTimeAsync(15001);await pending;});expect(old.current.unknown).toBe(true);
 act(()=>tree!.unmount());tree=undefined;const fresh=mount();await act(async()=>fresh.current.save({title:'Newer edit'}));
 expect(fresh.onSaved).toHaveBeenCalledTimes(1);expect(title).toBe('Newer edit');
 await act(async()=>finishOld());expect(title).toBe('Newer edit'); } finally { jest.useRealTimers(); }
});

it('uses the displayed version at full precision and never a fresh save-time version',async()=>{
 const h=mount();await act(async()=>h.current.save({title:'New title',image_url:null,location_text:'Park'},originalVersion));
 expect(mockWrite).toHaveBeenCalledWith('events',{title:'New title',image_url:null,location_text:'Park'},[['id','plan'],['creator_user_id','alice'],['updated_at',originalVersion]]);
 expect(mockRead).not.toHaveBeenCalled();expect(h.onSaved).toHaveBeenCalledTimes(1);
});
it('guards an explicit legacy null version instead of omitting the predicate',async()=>{
 const h=mount();await act(async()=>h.current.save({title:'New title'},null));
 expect(mockWrite.mock.calls[0][2]).toContainEqual(['updated_at',null]);expect(h.onSaved).toHaveBeenCalledTimes(1);
});
it.each(['', 'invalid', '2026-11-06'])('refuses an invalid displayed version %s before writing',async version=>{
 const h=mount();await act(async()=>h.current.save({title:'Keep this edit'},version));
 expect(mockWrite).not.toHaveBeenCalled();expect(h.onSaved).not.toHaveBeenCalled();expect(h.current.error).toContain('Your edits are still here');
});
it('keeps a zero-row conflict visible without claiming success or adopting a newer version',async()=>{
 mockWrite.mockResolvedValue({data:null,error:null});const h=mount();
 await act(async()=>h.current.save({title:'My unsaved title'}));
 expect(h.current.unknown).toBe(false);expect(h.current.error).toContain('Close and reopen');expect(h.onSaved).not.toHaveBeenCalled();
 await act(async()=>h.current.save({title:'Still my unsaved title'}));
 expect(mockWrite.mock.calls[1][2]).toContainEqual(['updated_at',originalVersion]);expect(mockRead).not.toHaveBeenCalled();
});
it('a matching read without an advanced version cannot confirm the pending write',async()=>{
 mockWrite.mockRejectedValue(new Error('Lost response'));mockRead.mockResolvedValue(success({title:'New title',updated_at:originalVersion}));
 const h=mount();await act(async()=>h.current.save({title:'New title'}));await act(async()=>h.current.check());
 expect(h.current.unknown).toBe(true);expect(h.onSaved).not.toHaveBeenCalled();expect(mockWrite).toHaveBeenCalledTimes(1);
});
it('a changed-version read with different fields releases uncertainty into a conflict, not Saved',async()=>{
 mockWrite.mockRejectedValue(new Error('Lost response'));mockRead.mockResolvedValue(success({title:'Other session',updated_at:savedVersion}));
 const h=mount();await act(async()=>h.current.save({title:'My unsaved title'}));await act(async()=>h.current.check());
 expect(h.current.unknown).toBe(false);expect(h.current.error).toContain('Your edits are still here');expect(h.onSaved).not.toHaveBeenCalled();
 await act(async()=>h.current.save({title:'My unsaved title'}));expect(mockWrite.mock.calls[1][2]).toContainEqual(['updated_at',originalVersion]);
});
it.each([undefined,null,originalVersion,'not-a-version'])('does not trust an unadvanced or incomplete returned version %p',async updated_at=>{
 mockWrite.mockResolvedValue(success({title:'New title',updated_at}));const h=mount();await act(async()=>h.current.save({title:'New title'}));
 expect(h.current.unknown).toBe(true);expect(h.onSaved).not.toHaveBeenCalled();
});
it('ignores a check finishing after leaving or switching account',async()=>{
 for(const leave of ['blur','retire'] as const){
  mockWrite.mockRejectedValue(new Error('Lost'));const h=mount();await act(async()=>h.current.save({title:'New title'}));
  const held=deferred();mockRead.mockReturnValueOnce(held.promise);let work!:Promise<void>;act(()=>{work=h.current.check();});await act(async()=>{await Promise.resolve();});h[leave]();
  await act(async()=>{held.resolve(success());await work;});expect(h.onSaved).not.toHaveBeenCalled();act(()=>tree!.unmount());tree=undefined;
 }
});
