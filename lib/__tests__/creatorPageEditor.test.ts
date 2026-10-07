import AsyncStorage from '@react-native-async-storage/async-storage';
const mockClearCover = jest.fn();
jest.mock('../creatorPageMedia',()=>({readPageCoverAttempt:async()=>null,pageCoverActionPending:()=>false,clearPageCoverAttempt:(...a:unknown[])=>mockClearCover(...a)}));
const mockSave = jest.fn(), mockSubmit = jest.fn(), mockReview = jest.fn(), mockFrom = jest.fn();
let mockSequence = 0;
jest.mock('expo-crypto',()=>({randomUUID:()=>`id-${++mockSequence}`}));
jest.mock('../supabase',()=>({supabase:{from:(...args:unknown[])=>mockFrom(...args)}}));
jest.mock('../creatorPageReview',()=>({ ...jest.requireActual('../creatorPageReview'), saveCreatorPageDraft:(...args:unknown[])=>mockSave(...args),submitCreatorPage:(...args:unknown[])=>mockSubmit(...args),loadCreatorPageReview:(...args:unknown[])=>mockReview(...args) }));
import { startPageEditor, persistPageEditor, readPageEditor, listLocalPageEditors, pageDraftProblems, pageCreatorProblems,
  attachPageCover, buildPageCreatorInformation, pageAudienceOptions, samePageData, savePageEditing, submitPageEditing, loadPageEditing, type PageEditorRecord } from '../creatorPageEditor';
const scope={userId:'creator',isCurrent:()=>true};
const complete=():PageEditorRecord=>({id:'page',kind:'community',version:0,pageData:{name:'Sunday Table',purpose:'Bring neighbors together',city:'Los Angeles',discovery_area:'Santa Monica',categories:['outdoors'],audience:'women_only'},creator:{name:'Aster',email:'aster@example.invalid',motivation:'Look after the space',guidelines:true}});
function query(data:unknown){const q:any={};for(const fn of ['select','eq','maybeSingle'])q[fn]=()=>q;q.then=(resolve:any)=>Promise.resolve({data,error:null}).then(resolve);return q;}
beforeEach(async()=>{jest.clearAllMocks();mockSequence=0;await AsyncStorage.clear();mockFrom.mockImplementation(table=>query(table==='profiles'?{id:'creator',gender:'woman'}:null));});
it('keeps brief creator answers separate from public page fields and does not invent assent',()=>{
 const r=complete();expect(buildPageCreatorInformation(r.creator)).toEqual({your_name:'Aster',contact_email:'aster@example.invalid',why_you:'Look after the space',creator_guidelines:true});
 expect(buildPageCreatorInformation({...r.creator,guidelines:false}).creator_guidelines).toBe(false);expect(r.pageData).not.toHaveProperty('contact_email');
});
it('matches page limits, required creator fields and declared-gender audience eligibility',()=>{
 const r=complete();expect(pageDraftProblems(r,'woman')).toEqual({});expect(pageDraftProblems(r,'man')).toHaveProperty('audience');
 expect(pageDraftProblems({...r,kind:'organization'},'woman')).toHaveProperty('audience');expect(pageAudienceOptions(null).map(o=>o.key)).toEqual(['everyone']);
 expect(pageAudienceOptions('non_binary').map(o=>o.key)).toEqual(['everyone','nonbinary_only']);
 expect(pageCreatorProblems({...r.creator,email:'bad',guidelines:false})).toEqual(expect.objectContaining({email:expect.any(String),guidelines:expect.any(String)}));
});
it('durably starts a local page and recovers its latest edits in only the owning account list',async()=>{
 const r=await startPageEditor(scope);await persistPageEditor({...r,pageData:{...r.pageData,name:'Working name'}},scope);
 expect((await readPageEditor(r.id,scope))?.pageData.name).toBe('Working name');expect(await listLocalPageEditors(scope)).toHaveLength(1);
 expect(await listLocalPageEditors({...scope,userId:'other'})).toEqual([]);expect(mockSave).not.toHaveBeenCalled();
});
it('serializes local keystrokes so an older write cannot overwrite newer text',async()=>{
 const r=complete();const a=persistPageEditor({...r,pageData:{...r.pageData,name:'Earlier'}},scope);const b=persistPageEditor({...r,pageData:{...r.pageData,name:'Latest'}},scope);
 await Promise.all([a,b]);expect((await readPageEditor(r.id,scope))?.pageData.name).toBe('Latest');
});
it('compares nested page data independently of JSON object key order',()=>{
 expect(samePageData({questions:[{id:1,text:'Question'}]},{questions:[{text:'Question',id:1}]})).toBe(true);
});
it('does not increment a saved version for an unchanged preview',async()=>{
 const r={...complete(),version:2};const saved={id:'page',version:2,page_data:r.pageData} as any;
 await expect(savePageEditing(r,saved,scope)).resolves.toMatchObject({version:2});expect(mockSave).not.toHaveBeenCalled();
});
it('retains a failed save attempt for a same-version retry, never silently overwriting',async()=>{
 const r=complete();mockSave.mockRejectedValueOnce(new Error('Lost response')).mockResolvedValueOnce({version:1});
 await expect(savePageEditing(r,null,scope)).rejects.toThrow('Lost response');const journal=(await readPageEditor('page',scope))!;
 expect(journal.pending).toMatchObject({kind:'save',expectedVersion:0,pageData:r.pageData});
 await savePageEditing(journal,null,scope);expect(mockSave.mock.calls[1]).toEqual(mockSave.mock.calls[0]);expect((await readPageEditor('page',scope))?.pending).toBeUndefined();
});
it('keeps exact submission ID and answers after an uncertain result',async()=>{
 const r={...complete(),version:1};mockSubmit.mockRejectedValueOnce(new Error('Lost response')).mockResolvedValueOnce({id:'id-1'});
 await expect(submitPageEditing(r,scope)).rejects.toThrow('Lost response');const journal=(await readPageEditor('page',scope))!;
 expect(journal.pending).toMatchObject({kind:'submit',submissionId:'id-1',expectedVersion:1});
 await submitPageEditing(journal,scope);expect(mockSubmit.mock.calls[1]).toEqual(mockSubmit.mock.calls[0]);expect(mockSequence).toBe(1);
});
it('reconciles a confirmed submission through read-only recovery',async()=>{
 const r=complete();r.version=1;r.pending={kind:'submit',submissionId:'attempt',expectedVersion:1,application:buildPageCreatorInformation(r.creator)};
 await persistPageEditor(r,scope);mockReview.mockResolvedValue({draft:{id:'page',page_kind:'community',version:1,page_data:r.pageData},submissions:[{id:'attempt',draft_version:1,application:r.pending.application,status:'submitted'}]});
 const loaded=await loadPageEditing('page',scope);expect(loaded?.confirmedSubmission).toBe(true);expect(loaded?.record.pending).toBeUndefined();expect(mockSubmit).not.toHaveBeenCalled();
});
it('keeps conflicting local edits without substituting a newer remote page',async()=>{
 const r={...complete(),version:1};await persistPageEditor(r,scope);mockReview.mockResolvedValue({draft:{id:'page',page_kind:'community',version:2,page_data:{...r.pageData,name:'Remote name'}},submissions:[]});
 const loaded=await loadPageEditing('page',scope);expect(loaded?.conflict).toBe(true);expect(loaded?.record.pageData.name).toBe('Sunday Table');expect(loaded?.fromServer?.pageData.name).toBe('Remote name');
});
it('blocks dispatch if local journaling fails or the account visit has expired',async()=>{
 jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Disk unavailable'));
 await expect(savePageEditing(complete(),null,scope)).rejects.toThrow();expect(mockSave).not.toHaveBeenCalled();
 await expect(submitPageEditing({...complete(),version:1},{...scope,isCurrent:()=>false})).rejects.toThrow();expect(mockSubmit).not.toHaveBeenCalled();
});

it('keeps a confirmed save final when optional local marker cleanup fails',async()=>{
 mockSave.mockImplementationOnce(async()=>{jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Cleanup failed'));return {version:1};});
 await expect(savePageEditing(complete(),null,scope)).resolves.toMatchObject({version:1,pending:undefined});
 expect((await readPageEditor('page',scope))?.pending?.kind).toBe('save');expect(mockSave).toHaveBeenCalledTimes(1);
});
it('keeps a confirmed submission final when optional local marker cleanup fails',async()=>{
 mockSubmit.mockImplementationOnce(async()=>{jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Cleanup failed'));return {id:'received'};});
 await expect(submitPageEditing({...complete(),version:1},scope)).resolves.toEqual({id:'received'});
 expect((await readPageEditor('page',scope))?.pending?.kind).toBe('submit');expect(mockSubmit).toHaveBeenCalledTimes(1);
});

it('retains upload recovery when attaching the cover cannot be persisted',async()=>{
 const attempt={pageId:'page',mediaId:'cover',byteSize:4,mimeType:'image/jpeg'} as any;
 const media={page_id:'page',id:'cover',created_by:'creator',ready_at:'ready',byte_size:4,mime_type:'image/jpeg'} as any;
 jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Disk full'));
 await expect(attachPageCover(complete(),attempt,media,scope)).rejects.toThrow('Disk full');expect(mockClearCover).not.toHaveBeenCalled();
});
it('preserves the attached cover receipt when only local cleanup fails',async()=>{
 const attempt={pageId:'page',mediaId:'cover',byteSize:4,mimeType:'image/jpeg'} as any;
 const media={page_id:'page',id:'cover',created_by:'creator',ready_at:'ready',byte_size:4,mime_type:'image/jpeg'} as any;
 mockClearCover.mockRejectedValueOnce(new Error('Cleanup failed'));
 const r=complete();r.pageData.photo_url='old-image';const next=await attachPageCover(r,attempt,media,scope);
 expect(next.pageData.cover_media_id).toBe('cover');expect(next.pageData.photo_url).toBeUndefined();expect(next.creator.guidelines).toBe(false);
 expect((await readPageEditor('page',scope))?.pageData.cover_media_id).toBe('cover');expect(mockSave).not.toHaveBeenCalled();
});
it('does not attach another page or account image or mutate an unresolved page save',async()=>{
 const attempt={pageId:'other',mediaId:'cover',byteSize:4,mimeType:'image/jpeg'} as any;
 const media={page_id:'other',id:'cover',created_by:'creator',ready_at:'ready',byte_size:4,mime_type:'image/jpeg'} as any;
 await expect(attachPageCover(complete(),attempt,media,scope)).rejects.toThrow('Check the saved page');expect(mockClearCover).not.toHaveBeenCalled();
});

it('exposes one original draft before storage settles, retaining its write through visit retirement',async()=>{
 const write=jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
 let finishWrite!:()=>void,active=true,prepared:PageEditorRecord|undefined;
 jest.mocked(AsyncStorage.setItem).mockImplementationOnce((storageKey,value)=>new Promise<void>((resolve,reject)=>{finishWrite=()=>{void Promise.resolve(write(storageKey,value)).then(()=>resolve(),reject);};}));
 let didPrepare!:()=>void;const preparedIdentity=new Promise<void>(resolve=>{didPrepare=resolve;});
 const pending=startPageEditor({...scope,isCurrent:()=>active},record=>{prepared=record;didPrepare();});
 await preparedIdentity;
 expect(prepared?.id).toBe('id-1');
 const rejected=expect(pending).rejects.toThrow();
 await Promise.resolve();await Promise.resolve();
 let readFinished=false;const read=readPageEditor(prepared!.id,scope).then(record=>{readFinished=true;return record;});
 await Promise.resolve();expect(readFinished).toBe(false);
 active=false;finishWrite();await rejected;
 expect(await read).toEqual(prepared);expect(mockSequence).toBe(1);
 expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});
it('does not prepare a new identity for an already retired page visit',async()=>{
 const prepared=jest.fn();await expect(startPageEditor({...scope,isCurrent:()=>false},prepared)).rejects.toThrow();
 expect(prepared).not.toHaveBeenCalled();expect(mockSequence).toBe(0);expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('requires an explicit LA area and one or two catalog categories for communities only',()=>{
 const r=complete();r.pageData={...r.pageData,discovery_area:null,categories:[]};
 expect(pageDraftProblems(r,'woman')).toEqual({discovery_area:expect.any(String),categories:expect.any(String)});
 expect(pageDraftProblems({...r,pageData:{...r.pageData,city:''}},'woman')).toHaveProperty('city');
 expect(pageDraftProblems({...r,pageData:{...r.pageData,discovery_area:'Many places around LA',categories:['music','outdoors']}},'woman')).toEqual({});
 for(const categories of [['music','music'],['music','outdoors','art'],['unknown']])expect(pageDraftProblems({...complete(),pageData:{...complete().pageData,categories}},'woman')).toHaveProperty('categories');
 expect(pageDraftProblems({...r,kind:'organization',pageData:{...r.pageData,city:'Los Angeles',audience:'everyone'}},'woman')).toEqual({});
});
it('does not invent community classification for a new private draft',async()=>{
 const record=await startPageEditor(scope);expect(record.pageData.discovery_area).toBeUndefined();expect(record.pageData.categories).toBeUndefined();
});
it('rejects a new incomplete submission before creating an attempt or sending it',async()=>{
 const record=complete();delete record.pageData.discovery_area;
 await expect(submitPageEditing(record,scope)).rejects.toThrow('Choose an area');expect(mockSubmit).not.toHaveBeenCalled();expect(mockSequence).toBe(0);expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it('preserves the exact original uncertain submission even if new classification fields are absent',async()=>{
 const record=complete();delete record.pageData.discovery_area;delete record.pageData.categories;
 record.pending={kind:'submit',submissionId:'original',expectedVersion:0,application:buildPageCreatorInformation(record.creator)};
 mockSubmit.mockResolvedValueOnce({id:'original'});await submitPageEditing(record,scope);
 expect(mockSubmit.mock.calls[0][0].submissionId).toBe('original');expect(mockSequence).toBe(0);
});
