import AsyncStorage from '@react-native-async-storage/async-storage';
const mockPhoto=jest.fn(),mockPhotoPending=jest.fn(),mockSave=jest.fn(),mockSaved=jest.fn();
let mockSequence=0;
jest.mock('expo-crypto',()=>({randomUUID:()=>`reservation-${++mockSequence}`}));
jest.mock('../supabase',()=>({supabase:{}}));
jest.mock('../creatorPageMedia',()=>({readPageCoverAttempt:(...args:unknown[])=>mockPhoto(...args),pageCoverActionPending:(...args:unknown[])=>mockPhotoPending(...args)}));
jest.mock('../creatorPageReview',()=>({...jest.requireActual('../creatorPageReview'),saveCreatorPageDraft:(...args:unknown[])=>mockSave(...args)}));
jest.mock('../creatorPageWorkspace',()=>({listCreatorPages:(...args:unknown[])=>mockSaved(...args)}));
jest.mock('../creatorPageTeam',()=>({listMyPageTeamInvitations:async()=>[]}));
jest.mock('../creatorMode',()=>({getCreatorAccess:async()=>({ledCommunities:[],hasLeaderGrant:false,hasEventHostGrant:false}),creatorLandingRoute:()=>'/creator/pages'}));
import {startPageEditor,readPageEditor,persistPageEditor,listLocalPageEditors,savePageEditing,type PageEditorRecord} from '../creatorPageEditor';
import {loadCreatorSpaceEntry} from '../creatorSpaceEntry';
const scope={userId:'creator',isCurrent:()=>true};
const initial=(id='old'):PageEditorRecord=>({id,kind:'community',version:0,pageData:{name:'',purpose:'',city:'Los Angeles',audience:'everyone'},creator:{name:'',email:'',motivation:'',guidelines:false}});
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();mockSequence=0;mockPhoto.mockReset().mockResolvedValue(null);mockPhotoPending.mockReset().mockReturnValue(false);mockSaved.mockReset().mockResolvedValue([]);mockSave.mockReset().mockResolvedValue({version:1});});
it('opening then leaving an untouched editor keeps its identity but does not add a visible draft or Creator space count',async()=>{
 const before=await loadCreatorSpaceEntry(scope);
 const record=await startPageEditor(scope);
 expect(await readPageEditor(record.id,scope)).toEqual(record);
 expect(await listLocalPageEditors(scope)).toEqual([]);
 expect(await loadCreatorSpaceEntry(scope)).toEqual(before);
 expect(mockSave).not.toHaveBeenCalled();expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
});
it('a second Create reuses the same untouched identity without another UUID or write',async()=>{
 const first=await startPageEditor(scope);const writes=jest.mocked(AsyncStorage.setItem).mock.calls.length;
 const prepared=jest.fn();const second=await startPageEditor(scope,prepared);
 expect(second).toEqual(first);expect(prepared).toHaveBeenCalledTimes(1);expect(prepared).toHaveBeenCalledWith(first);
 expect(mockSequence).toBe(1);expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
});
it('does not inflate an existing multi-space count when an untouched editor is opened twice',async()=>{
 mockSaved.mockResolvedValue(['one','two','three'].map(id=>({id,page_kind:'community',page_data:{name:id}})));
 const before=await loadCreatorSpaceEntry(scope);await startPageEditor(scope);await startPageEditor(scope);
 expect(await loadCreatorSpaceEntry(scope)).toEqual(before);expect(before.subtitle).toBe('one · two +1 more');
});
it('hides old pristine reservations without deleting them and reuses one of their original IDs',async()=>{
 await persistPageEditor(initial('old-one'),scope);await persistPageEditor(initial('old-two'),scope);
 expect(await listLocalPageEditors(scope)).toEqual([]);
 const record=await startPageEditor(scope);expect(['old-one','old-two']).toContain(record.id);expect(mockSequence).toBe(0);
 expect(await readPageEditor('old-one',scope)).toEqual(initial('old-one'));expect(await readPageEditor('old-two',scope)).toEqual(initial('old-two'));
 expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
});
it.each([
 ['organization',(r:PageEditorRecord)=>({...r,kind:'organization' as const})],
 ['name',(r:PageEditorRecord)=>({...r,pageData:{...r.pageData,name:'Sunday Table'}})],
 ['purpose only',(r:PageEditorRecord)=>({...r,pageData:{...r.pageData,purpose:'Bring neighbors together'}})],
 ['city',(r:PageEditorRecord)=>({...r,pageData:{...r.pageData,city:'Malibu'}})],
 ['audience',(r:PageEditorRecord)=>({...r,pageData:{...r.pageData,audience:'women_only'}})],
 ['classification',(r:PageEditorRecord)=>({...r,pageData:{...r.pageData,categories:['outdoors']}})],
 ['future field',(r:PageEditorRecord)=>({...r,pageData:{...r.pageData,new_field:''}})],
 ['future record field',(r:PageEditorRecord)=>({...r,future_recovery:{attempt:'original'}})],
 ['future creator field',(r:PageEditorRecord)=>({...r,creator:{...r.creator,future_answer:'Keep this'}})],
 ['creator name',(r:PageEditorRecord)=>({...r,creator:{...r.creator,name:'Aster'}})],
 ['creator email',(r:PageEditorRecord)=>({...r,creator:{...r.creator,email:'aster@example.invalid'}})],
 ['creator motivation',(r:PageEditorRecord)=>({...r,creator:{...r.creator,motivation:'Look after this space'}})],
 ['guidelines',(r:PageEditorRecord)=>({...r,creator:{...r.creator,guidelines:true}})],
 ['confirmed save',(r:PageEditorRecord)=>({...r,version:1})],
 ['pending save',(r:PageEditorRecord)=>({...r,pending:{kind:'save' as const,expectedVersion:0,pageData:r.pageData}})],
 ['pending submit',(r:PageEditorRecord)=>({...r,pending:{kind:'submit' as const,expectedVersion:0,submissionId:'original',application:{}}})],
 ['attached photo',(r:PageEditorRecord)=>({...r,pageData:{...r.pageData,cover_media_id:'cover'}})],
] as const)('keeps %s visible and gives the next page a different identity',async(_label,change)=>{
 const edited=change(initial());await persistPageEditor(edited,scope);
 expect(await listLocalPageEditors(scope)).toEqual([edited]);
 const next=await startPageEditor(scope);expect(next.id).not.toBe(edited.id);
 expect(await readPageEditor(edited.id,scope)).toEqual(edited);expect(await listLocalPageEditors(scope)).toEqual([edited]);
});
it('an explicit Save draft remains visible even with untouched fields',async()=>{
 const reservation=await startPageEditor(scope);const saved=await savePageEditing(reservation,null,scope);
 expect(saved.version).toBe(1);expect(await listLocalPageEditors(scope)).toEqual([saved]);
 expect((await startPageEditor(scope)).id).not.toBe(saved.id);
});
it.each(['pending','unreadable'])('keeps %s photo recovery visible and never reuses that page',async state=>{
 const record=initial();await persistPageEditor(record,scope);
 mockPhoto.mockImplementation(async id=>{if(id!==record.id)return null;if(state==='unreadable')throw Error('Cannot read photo marker');return {pageId:record.id,mediaId:'cover'};});
 expect(await listLocalPageEditors(scope)).toEqual([record]);
 expect((await loadCreatorSpaceEntry(scope)).spaces[0].id).toBe(record.id);
 expect((await startPageEditor(scope)).id).not.toBe(record.id);expect(await readPageEditor(record.id,scope)).toEqual(record);
});
it('reuses only the current account reservation and retains the other account content',async()=>{
 const first=await startPageEditor(scope);const other={...scope,userId:'another'};
 const second=await startPageEditor(other);expect(second.id).not.toBe(first.id);
 await persistPageEditor({...second,pageData:{...second.pageData,name:'Another account'}},other);
 expect((await startPageEditor(scope)).id).toBe(first.id);expect(await listLocalPageEditors(scope)).toEqual([]);
 expect((await listLocalPageEditors(other))[0].pageData.name).toBe('Another account');
});
it('retires a reuse lookup before exposing an identity if its account visit changes',async()=>{
 await persistPageEditor(initial(),scope);let active=true;
 mockPhoto.mockImplementationOnce(async()=>{active=false;return null;});const prepared=jest.fn();
 await expect(startPageEditor({...scope,isCurrent:()=>active},prepared)).rejects.toThrow();
 expect(prepared).not.toHaveBeenCalled();expect(mockSequence).toBe(0);
});

it('concurrent Create visits reserve one account identity without competing writes',async()=>{
 const preparedA=jest.fn(),preparedB=jest.fn();
 const [first,second]=await Promise.all([startPageEditor(scope,preparedA),startPageEditor({...scope},preparedB)]);
 expect(second).toEqual(first);expect(mockSequence).toBe(1);expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
 expect(preparedA).toHaveBeenCalledWith(first);expect(preparedB).toHaveBeenCalledWith(first);
});
it('concurrent accounts reserve independently without sharing identities',async()=>{
 const [first,second]=await Promise.all([startPageEditor(scope),startPageEditor({...scope,userId:'another'})]);
 expect(first.id).not.toBe(second.id);expect(mockSequence).toBe(2);
 expect(await readPageEditor(first.id,{...scope,userId:'another'})).toBeNull();
});
it('a new visit waits for the retired visit original write then reuses its ID under its own scope',async()=>{
 const write=jest.mocked(AsyncStorage.setItem).getMockImplementation()!;let finish!:()=>void,active=true;
 jest.mocked(AsyncStorage.setItem).mockImplementationOnce((key,value)=>new Promise<void>((resolve,reject)=>{finish=()=>{void Promise.resolve(write(key,value)).then(()=>resolve(),reject);};}));
 let prepared!:PageEditorRecord,didPrepare!:()=>void;const preparedIdentity=new Promise<void>(resolve=>{didPrepare=resolve;});
 const first=startPageEditor({...scope,isCurrent:()=>active},record=>{prepared=record;didPrepare();});const rejected=expect(first).rejects.toThrow();
 await preparedIdentity;await Promise.resolve();await Promise.resolve();active=false;
 const second=startPageEditor(scope);let settled=false;void second.then(()=>{settled=true;});
 await Promise.resolve();expect(settled).toBe(false);finish();await rejected;
 expect(await second).toEqual(prepared);expect(mockSequence).toBe(1);expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});
it('a queued visit retired before selection does not acquire the earlier reservation',async()=>{
 let active=true;const first=startPageEditor(scope);const prepared=jest.fn();
 const second=startPageEditor({...scope,isCurrent:()=>active},prepared);const rejected=expect(second).rejects.toThrow();active=false;
 await first;await rejected;expect(prepared).not.toHaveBeenCalled();expect(mockSequence).toBe(1);
});
it('does not reuse a stale pristine snapshot after edits finish during the photo read',async()=>{
 const record=initial();await persistPageEditor(record,scope);const edited={...record,pageData:{...record.pageData,name:'Saved while checking'}};
 mockPhoto.mockImplementationOnce(async()=>{await persistPageEditor(edited,scope);return null;});
 expect((await startPageEditor(scope)).id).not.toBe(record.id);expect(await readPageEditor(record.id,scope)).toEqual(edited);
});

it('lists the latest edits if they settle while an unchanged reservation photo marker is checked',async()=>{
 const record=initial();await persistPageEditor(record,scope);const edited={...record,pageData:{...record.pageData,purpose:'Keep this unfinished idea'}};
 mockPhoto.mockImplementationOnce(async()=>{await persistPageEditor(edited,scope);return null;});
 expect(await listLocalPageEditors(scope)).toEqual([edited]);
});

it('keeps an earlier visit pending photo action visible before its marker is readable and gives Create a distinct ID',async()=>{
 const record=initial();await persistPageEditor(record,scope);mockPhotoPending.mockImplementation(id=>id===record.id);
 expect(await listLocalPageEditors(scope)).toEqual([record]);expect((await startPageEditor(scope)).id).not.toBe(record.id);
 expect(await readPageEditor(record.id,scope)).toEqual(record);
});
it.each(['list','create'])('rechecks a photo marker committed during the editor reread before %s hides or reuses its ID',async mode=>{
 const record=initial();await persistPageEditor(record,scope);
 mockPhoto.mockResolvedValueOnce(null).mockResolvedValue({pageId:record.id,mediaId:'original-cover'});
 if(mode==='list')expect(await listLocalPageEditors(scope)).toEqual([record]);
 else expect((await startPageEditor(scope)).id).not.toBe(record.id);
 expect(mockPhoto).toHaveBeenCalledTimes(2);
});
it('keeps photo work that starts during the marker read visible without waiting for the action',async()=>{
 const record=initial();await persistPageEditor(record,scope);
 mockPhoto.mockImplementationOnce(async()=>{mockPhotoPending.mockReturnValue(true);return null;});
 expect(await listLocalPageEditors(scope)).toEqual([record]);
});

it.each(['{broken',JSON.stringify({id:'broken',kind:'community'})])('skips only malformed reservation candidates without removing their bytes or softening directory errors (%s)',async raw=>{
 const key='creator-page-editor:v1:creator:broken';await AsyncStorage.setItem(key,raw);await persistPageEditor(initial('existing'),scope);
 const prepared=jest.fn();expect((await startPageEditor(scope,prepared)).id).toBe('existing');expect(mockSequence).toBe(0);
 expect(await AsyncStorage.getItem(key)).toBe(raw);expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
 await expect(listLocalPageEditors(scope)).rejects.toThrow('Could not read the saved page draft.');
});
it('can reserve a new identity when older malformed records are the only local candidates',async()=>{
 const key='creator-page-editor:v1:creator:broken';await AsyncStorage.setItem(key,'{broken');
 expect((await startPageEditor(scope)).id).toBe('reservation-1');expect(await AsyncStorage.getItem(key)).toBe('{broken');
 await expect(listLocalPageEditors(scope)).rejects.toThrow('Could not read the saved page draft.');
});
it.each(['keys','record'])('does not turn a %s storage I/O failure into a new draft',async kind=>{
 await persistPageEditor(initial(),scope);
 if(kind==='keys')jest.mocked(AsyncStorage.getAllKeys).mockRejectedValueOnce(Error('Storage unavailable'));
 else jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(Error('Storage unavailable'));
 const prepared=jest.fn();await expect(startPageEditor(scope,prepared)).rejects.toThrow('Storage unavailable');
 expect(prepared).not.toHaveBeenCalled();expect(mockSequence).toBe(0);expect(await readPageEditor('old',scope)).toEqual(initial());
});
