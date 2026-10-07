import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockLoad=jest.fn(),mockPersist=jest.fn(),mockSave=jest.fn(),mockSubmit=jest.fn(),mockReplace=jest.fn();
const mockPick=jest.fn(),mockUpload=jest.fn(),mockCheck=jest.fn(),mockClear=jest.fn(),mockAttach=jest.fn();
jest.mock('../../../../lib/creatorPageMedia',()=>({pickPageCover:(...a:unknown[])=>mockPick(...a),uploadPageCover:(...a:unknown[])=>mockUpload(...a),checkPageCover:(...a:unknown[])=>mockCheck(...a),clearPageCoverAttempt:(...a:unknown[])=>mockClear(...a)}));
jest.mock('../../../ProfileButton',()=>({__esModule:true,default:()=>null,ProfileButton:()=>null}));
jest.mock('../PageCover',()=>({PageCover:()=>null}));
import { PageCover } from '../PageCover';
let mockAccountError: Error | null = null;
let mockFocused=true,mockEpoch=0;
let mockCurrent=true;
let mockScope={userId:'creator',isCurrent:()=>mockCurrent};
let mockScopesByPage: Record<string, typeof mockScope> | undefined;
jest.mock('../../../../hooks/useCreatorPageScope',()=>({useCreatorPageScope:(pageId:string)=>({scope:mockAccountError ? null : mockScopesByPage?.[pageId] ?? mockScope,focused:mockFocused,account:{viewerId:'creator',epoch:mockEpoch,isLoading:false,error:mockAccountError,isCurrent:()=>mockCurrent}})}));
jest.mock('../../../../hooks/useAfterglowFonts',()=>({useAfterglowFonts:()=>({fonts:{regular:'System',medium:'System',semibold:'System',display:'System'}})}));
jest.mock('../../../../lib/creatorPageEditor',()=>({ ...jest.requireActual('../../../../lib/creatorPageEditor'),loadPageEditing:(...args:unknown[])=>mockLoad(...args),persistPageEditor:(...args:unknown[])=>mockPersist(...args),savePageEditing:(...args:unknown[])=>mockSave(...args),submitPageEditing:(...args:unknown[])=>mockSubmit(...args),attachPageCover:(...args:unknown[])=>mockAttach(...args)}));
jest.mock('../../../../lib/supabase',()=>({supabase:{}}));
jest.mock('expo-router',()=>({router:{dismissTo:(...args:unknown[])=>mockReplace(...args),replace:(...args:unknown[])=>mockReplace(...args),canGoBack:()=>true,back:()=>{}},Stack:{Screen:()=>null}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:require('react-native').View}));
jest.mock('../../../../lib/haptics',()=>({hapticLight:()=>{},hapticSelection:()=>{}}));
import CreatorPageEditorScreen from '../CreatorPageEditorScreen';
import { CommunityClassificationFields } from '../CommunityClassificationFields';
import { PageAction, PageFrame } from '../PageFrame';
import { Field } from '../../ApplyFormKit';
import { Pressable, Text, TextInput, Dimensions, ScrollView } from 'react-native';
let tree:ReactTestRenderer,data:any;
const action=(title:string)=>tree.root.findAllByType(PageAction).find(a=>a.props.title===title)!;
const field=(label:string)=>tree.root.findAllByType(Field).find(f=>f.props.label===label)!;
async function mount(){await act(async()=>{tree=create(<CreatorPageEditorScreen pageId="page"/>);});}
beforeEach(()=>{jest.clearAllMocks();mockAccountError=null;mockFocused=true;mockEpoch=0;mockScopesByPage=undefined;mockCurrent=true;mockScope={userId:'creator',isCurrent:()=>mockCurrent};data={record:{id:'page',kind:'community',version:0,pageData:{name:'Sunday Table',purpose:'Bring neighbors together',city:'Los Angeles',discovery_area:'Santa Monica',categories:['outdoors'],audience:'women_only'},creator:{name:'',email:'',motivation:'',guidelines:false}},saved:null,submissions:[],gender:'woman',published:false,conflict:false};mockLoad.mockImplementation(async()=>data);mockPersist.mockResolvedValue(undefined);mockSave.mockImplementation(async(record:any)=>{const next={...record,version:1};data={...data,record:next,saved:{version:1,page_data:next.pageData}};return next;});mockSubmit.mockResolvedValue({id:'submission'});});
afterEach(()=>{act(()=>tree?.unmount());jest.useRealTimers();});
it('requires preview and explicit creator information before submitting once',async()=>{
 await mount();expect(mockSubmit).not.toHaveBeenCalled();await act(async()=>{action('Save and continue').props.onPress();});
 expect(mockSave).toHaveBeenCalledTimes(1);act(()=>action('Continue').props.onPress());
 act(()=>action('Submit for review').props.onPress());expect(mockSubmit).not.toHaveBeenCalled();
 act(()=>field('Your name').props.onChange('Aster'));act(()=>field('Contact email').props.onChange('aster@example.invalid'));act(()=>field('Tell us what you have in mind').props.onChange('Look after this space'));
 act(()=>tree.root.findAll(p=>p.props.accessibilityRole==='checkbox' && typeof p.props.onPress==='function')[0].props.onPress());
 const submit=action('Submit for review').props.onPress;await act(async()=>{submit();submit();});
 expect(mockSubmit).toHaveBeenCalledTimes(1);expect(mockSubmit.mock.calls[0][0].creator).toEqual({name:'Aster',email:'aster@example.invalid',motivation:'Look after this space',guidelines:true});
 expect(mockReplace).toHaveBeenCalledWith('/creator/page?id=page');
});
it('saves partial work privately without interrupting the editor or requiring submission',async()=>{
 data.record.pageData.name='';await mount();await act(async()=>{action('Save draft').props.onPress();});
 expect(mockSave).toHaveBeenCalledTimes(1);expect(mockSubmit).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();expect(field('Name').props.value).toBe('');expect(action('Save and continue')).toBeDefined();
});
it('keeps a pending review distinct from editable private preparation',async()=>{
 data.submissions=[{id:'old-review',status:'submitted'}];await mount();
 expect(JSON.stringify(tree.toJSON())).toContain('Private draft');expect(JSON.stringify(tree.toJSON())).not.toContain('Step 1 of 3');
 await act(async()=>{action('Save and continue').props.onPress();});
 expect(JSON.stringify(tree.toJSON())).toContain('Private preview');expect(JSON.stringify(tree.toJSON())).not.toContain('Step 2 of 3');expect(JSON.stringify(tree.toJSON())).not.toContain('Next: creator details');
 expect(action('Continue')).toBeUndefined();expect(action('Back to page')).toBeDefined();expect(mockSubmit).not.toHaveBeenCalled();
});
it('retains conflicting local edits and does not silently overwrite a newer saved page',async()=>{
 data.conflict=true;data.fromServer={...data.record,pageData:{...data.record.pageData,name:'Newer saved name'}};await mount();
 expect(field('Name').props.value).toBe('Sunday Table');expect(field('Name').props.editable).toBe(false);expect(action('Save and continue')).toBeUndefined();expect(mockSave).not.toHaveBeenCalled();
});
it('keeps an uncertain submission attached to the same attempt and exposes read recovery',async()=>{
 data.record.version=1;data.record.pending={kind:'submit',submissionId:'original',expectedVersion:1,application:{your_name:'Aster'}};
 await mount();expect(action('Check saved status')).toBeDefined();expect(action('Retry submission')).toBeDefined();expect(mockSubmit).not.toHaveBeenCalled();expect(field('Name').props.editable).toBe(false);
});

it('cancels photo selection without creating a remote draft or submitting',async()=>{
 mockPick.mockResolvedValueOnce(null);await mount();await act(async()=>action('Pick photo').props.onPress());
 expect(mockSave).not.toHaveBeenCalled();expect(mockUpload).not.toHaveBeenCalled();expect(mockSubmit).not.toHaveBeenCalled();
});
it('recovers the same pending photo and requires its decoded preview before continuing',async()=>{
 const attempt={pageId:'page',mediaId:'cover'};
 mockPick.mockImplementationOnce(async()=>{data={...data,coverAttempt:attempt};return attempt;});
 mockUpload.mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce({id:'cover'});
 mockCheck.mockResolvedValueOnce(null);
 mockAttach.mockImplementationOnce(async(r:any)=>{const next={...r,pageData:{...r.pageData,cover_media_id:'cover'}};data={...data,record:next,coverAttempt:null};return next;});
 await mount();await act(async()=>action('Pick photo').props.onPress());
 await act(async()=>action('Check saved status').props.onPress());
 expect(action('Check photo')).toBeDefined();expect(action('Save and continue').props.disabled).toBe(true);
 const writes=mockSave.mock.calls.length;await act(async()=>action('Check photo').props.onPress());
 expect(mockSave).toHaveBeenCalledTimes(writes);expect(mockUpload).toHaveBeenCalledTimes(1);
 await act(async()=>action('Resume upload').props.onPress());expect(mockUpload.mock.calls[1][0]).toBe(attempt);
 expect(action('Check photo')).toBeUndefined();await act(async()=>action('Save and continue').props.onPress());
 expect(action('Continue').props.disabled).toBe(true);
 act(()=>tree.root.findByType(PageCover).props.onReady(true));expect(action('Continue').props.disabled).toBe(false);
 act(()=>tree.root.findByType(PageCover).props.onReady(false));expect(action('Continue').props.disabled).toBe(true);
 expect(mockSubmit).not.toHaveBeenCalled();
});
it('discards only the pending selection so the saved cover can still be used',async()=>{
 data.coverAttempt={pageId:'page',mediaId:'pending'};data.record.pageData.cover_media_id='saved';
 mockClear.mockImplementationOnce(async()=>{data={...data,coverAttempt:null};});await mount();
 await act(async()=>action('Discard selection').props.onPress());expect(action('Check photo')).toBeUndefined();
 expect(tree.root.findByType(PageCover).props.mediaId).toBe('saved');expect(mockUpload).not.toHaveBeenCalled();expect(mockSave).not.toHaveBeenCalled();
});
it('can retry a pending page save while keeping its photo upload separate',async()=>{
 data.coverAttempt={pageId:'page',mediaId:'pending'};data.record.pending={kind:'save',expectedVersion:0,pageData:data.record.pageData};
 mockSave.mockImplementationOnce(async(r:any)=>{const next={...r,version:1,pending:undefined};data={...data,record:next,saved:{version:1,page_data:next.pageData}};return next;});
 await mount();await act(async()=>action('Retry save').props.onPress());
 expect(mockSave).toHaveBeenCalledTimes(1);expect(mockUpload).not.toHaveBeenCalled();expect(action('Resume upload')).toBeDefined();expect(action('Continue')).toBeUndefined();
});

function deferred<T>() { let resolve!: (value:T)=>void, reject!: (reason?:unknown)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
it('releases a stalled save into read-only recovery without starting a second save',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});
 const pending=deferred<any>();mockSave.mockReturnValueOnce(pending.promise);
 await mount();act(()=>action('Save and continue').props.onPress());
 expect(tree.root.findByType(PageFrame).props.busy).toBe(true);
 await act(async()=>{jest.advanceTimersByTime(25_001);});
 expect(tree.root.findByType(PageFrame).props.busy).toBe(false);
 expect(action('Check saved status')).toBeDefined();
 expect(mockSave).toHaveBeenCalledTimes(1);
 jest.useRealTimers();
});

it('checks without another mutation while the original save is still unresolved',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});const pending=deferred<any>();mockSave.mockReturnValueOnce(pending.promise);
 await mount();const save=action('Save and continue').props.onPress;act(()=>save());
 await act(async()=>jest.advanceTimersByTime(25_001));
 await act(async()=>action('Check saved status').props.onPress());
 expect(field('Name').props.editable).toBe(false);act(()=>save());expect(mockSave).toHaveBeenCalledTimes(1);
 expect(action('Check saved status')).toBeDefined();
 expect(mockReplace).not.toHaveBeenCalled();
});
it('requires an explicit check after a late save and keeps later edits when its old callback finishes',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});const pending=deferred<any>();mockSave.mockReturnValueOnce(pending.promise);
 await mount();act(()=>action('Save and continue').props.onPress());
 await act(async()=>jest.advanceTimersByTime(25_001));
 const next={...data.record,version:1};data={...data,record:next,saved:{version:1,page_data:next.pageData}};
 await act(async()=>pending.resolve(next));
 expect(action('Continue')).toBeUndefined();expect(mockReplace).not.toHaveBeenCalled();
 await act(async()=>action('Check saved status').props.onPress());
 expect(action('Check saved status')).toBeUndefined();expect(field('Name').props.editable).toBe(true);
 act(()=>field('Name').props.onChange('Keep this later name'));
 expect(field('Name').props.value).toBe('Keep this later name');expect(mockSave).toHaveBeenCalledTimes(1);
});
it('bounds a stalled status check while keeping the form and Check reachable',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});mockSave.mockRejectedValueOnce(new Error('Lost response'));
 await mount();await act(async()=>action('Save and continue').props.onPress());
 const pending=deferred<any>();mockLoad.mockReturnValueOnce(pending.promise);
 act(()=>action('Check saved status').props.onPress());await act(async()=>jest.advanceTimersByTime(12_001));
 expect(tree.root.findByType(PageFrame).props.busy).toBe(false);expect(action('Check saved status').props.disabled).toBe(false);
 expect(field('Name').props.value).toBe('Sunday Table');expect(mockSave).toHaveBeenCalledTimes(1);
 await act(async()=>pending.resolve({...data,record:{...data.record,pageData:{...data.record.pageData,name:'Stale read'}}}));
 expect(field('Name').props.value).toBe('Sunday Table');
});
it('does not navigate after the account or visit retires during a save',async()=>{
 const pending=deferred<any>();mockSave.mockReturnValueOnce(pending.promise);await mount();
 act(()=>action('Save draft').props.onPress());mockCurrent=false;
 await act(async()=>pending.resolve({...data.record,version:1}));expect(mockReplace).not.toHaveBeenCalled();
});
it('bounds a stalled submission and checks the same original submission without resending it',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});data.record.version=1;data.record.creator={name:'Aster',email:'aster@example.invalid',motivation:'Look after this space',guidelines:true};
 await mount();await act(async()=>action('Save and continue').props.onPress());act(()=>action('Continue').props.onPress());
 const pending=deferred<any>();mockSubmit.mockImplementationOnce((r:any)=>{data={...data,record:{...r,pending:{kind:'submit',submissionId:'original-submission',expectedVersion:r.version,application:{your_name:'Aster'}}}};return pending.promise;});
 act(()=>action('Submit for review').props.onPress());await act(async()=>jest.advanceTimersByTime(25_001));
 expect(action('Check saved status')).toBeDefined();expect(mockSubmit).toHaveBeenCalledTimes(1);
 await act(async()=>pending.resolve({id:'original-submission'}));expect(mockReplace).not.toHaveBeenCalled();
 data={...data,record:{...data.record,pending:undefined},confirmedSubmission:true};
 await act(async()=>action('Check saved status').props.onPress());
 expect(mockSubmit).toHaveBeenCalledTimes(1);expect(mockReplace).toHaveBeenCalledWith('/creator/page?id=page');
});
it('keeps deliberate picker time outside the deadline and resumes normally after cancellation',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});const selected=deferred<any>();
 mockPick.mockImplementationOnce(async(_id:any,_scope:any,open:(v:boolean)=>void)=>{open(true);try{return await selected.promise;}finally{open(false);}});
 await mount();act(()=>action('Pick photo').props.onPress());
 await act(async()=>jest.advanceTimersByTime(60_000));
 expect(action('Check saved status')).toBeUndefined();expect(action('Choosing photo…')).toBeDefined();
 await act(async()=>selected.resolve(null));
 expect(tree.root.findByType(PageFrame).props.busy).toBe(false);expect(field('Name').props.editable).toBe(true);
 expect(mockSave).not.toHaveBeenCalled();expect(mockUpload).not.toHaveBeenCalled();
});
it('bounds a stalled photo upload and recovers only its original selection',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});const upload=deferred<any>(),attempt={pageId:'page',mediaId:'original-cover'};
 mockPick.mockImplementationOnce(async()=>{data={...data,coverAttempt:attempt};return attempt;});mockUpload.mockReturnValueOnce(upload.promise);
 await mount();await act(async()=>action('Pick photo').props.onPress());await act(async()=>jest.advanceTimersByTime(25_001));
 expect(action('Check saved status')).toBeDefined();await act(async()=>action('Check saved status').props.onPress());
 expect(mockPick).toHaveBeenCalledTimes(1);expect(mockUpload).toHaveBeenCalledTimes(1);expect(mockAttach).not.toHaveBeenCalled();
 await act(async()=>upload.resolve({id:'original-cover'}));expect(mockAttach).not.toHaveBeenCalled();
 await act(async()=>action('Check saved status').props.onPress());
 expect(action('Check photo')).toBeDefined();expect(action('Resume upload')).toBeDefined();
 expect(mockPick).toHaveBeenCalledTimes(1);expect(mockUpload).toHaveBeenCalledTimes(1);
});
it('does not let an older autosave failure replace current edit feedback',async()=>{
 const older=deferred<void>();mockPersist.mockReturnValueOnce(older.promise);await mount();
 act(()=>field('Name').props.onChange('First name'));act(()=>field('Name').props.onChange('Latest name'));
 await act(async()=>older.reject(new Error('Old write failed')));
 expect(field('Name').props.value).toBe('Latest name');
 expect(JSON.stringify(tree.toJSON())).not.toContain('Your latest edits have not been saved');
});
it('times out initial metadata loading and retries without accepting its late result',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});const pending=deferred<any>();mockLoad.mockReturnValueOnce(pending.promise);
 await mount();await act(async()=>jest.advanceTimersByTime(12_001));expect(action('Try loading again')).toBeDefined();
 await act(async()=>action('Try loading again').props.onPress());expect(field('Name').props.value).toBe('Sunday Table');
 act(()=>field('Name').props.onChange('Current draft'));
 await act(async()=>pending.resolve({...data,record:{...data.record,pageData:{...data.record.pageData,name:'Older metadata'}}}));
 expect(field('Name').props.value).toBe('Current draft');
});

it('retires an old save when a different visit mounts even if the old scope callback stays true',async()=>{
 const pending=deferred<any>();mockSave.mockReturnValueOnce(pending.promise);await mount();
 act(()=>action('Save draft').props.onPress());
 mockScope={userId:'another-creator',isCurrent:()=>true};
 data={...data,record:{...data.record,id:'other-page',pageData:{...data.record.pageData,name:'Other page'}}};
 await act(async()=>tree.update(<CreatorPageEditorScreen pageId="other-page"/>));
 await act(async()=>pending.resolve({id:'page',version:1}));
 expect(mockReplace).not.toHaveBeenCalled();expect(field('Name').props.value).toBe('Other page');expect(field('Name').props.editable).toBe(true);
});
it('preserves the captured save identity until a fresh read exposes its exact retry',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});const pending=deferred<any>();
 mockSave.mockImplementationOnce((r:any)=>{data={...data,record:{...r,pending:{kind:'save',expectedVersion:r.version,pageData:r.pageData}}};return pending.promise;});
 await mount();act(()=>action('Save and continue').props.onPress());await act(async()=>jest.advanceTimersByTime(25_001));
 await act(async()=>pending.reject(new Error('Lost save response')));
 await act(async()=>action('Check saved status').props.onPress());
 expect(action('Retry save')).toBeDefined();expect(field('Name').props.editable).toBe(false);
 expect(mockSave).toHaveBeenCalledTimes(1);expect(data.record.pending.expectedVersion).toBe(0);
 await act(async()=>action('Retry save').props.onPress());
 expect(mockSave.mock.calls[1][0].pending).toEqual({kind:'save',expectedVersion:0,pageData:{name:'Sunday Table',purpose:'Bring neighbors together',city:'Los Angeles',discovery_area:'Santa Monica',categories:['outdoors'],audience:'women_only'}});
});

it('keeps unsaved current text when checking finds an older device copy at the same version',async()=>{
 mockPersist.mockRejectedValue(new Error('Device save failed'));mockSave.mockRejectedValueOnce(new Error('Cannot persist attempt'));
 await mount();await act(async()=>field('Name').props.onChange('Keep the unsaved name'));
 await act(async()=>action('Save and continue').props.onPress());
 expect(action('Check saved status')).toBeDefined();await act(async()=>action('Check saved status').props.onPress());
 expect(field('Name').props.value).toBe('Keep the unsaved name');expect(field('Name').props.editable).toBe(true);
 expect(mockSave).toHaveBeenCalledTimes(1);expect(mockSave.mock.calls[0][0].pageData.name).toBe('Keep the unsaved name');
});

it.each(['approved','published'])('existing editor links continue %s pages in their approved content editor',async status=>{
 data.published=status==='published';data.submissions=status==='approved'?[{id:'approved',status:'approved'}]:[];await mount();
 expect(mockReplace).toHaveBeenCalledWith('/creator/page-edit?id=page&mode=approved');expect(mockSubmit).not.toHaveBeenCalled();expect(mockSave).not.toHaveBeenCalled();
});

it('requires community classification before review, but lets an incomplete private draft save',async()=>{
 delete data.record.pageData.discovery_area;delete data.record.pageData.categories;
 await mount();expect(field('City')).toBeUndefined();
 await act(async()=>action('Save and continue').props.onPress());
 expect(mockSave).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('Choose an area in LA');
 expect(JSON.stringify(tree.toJSON())).toContain('Choose one or two categories');
 await act(async()=>action('Save draft').props.onPress());
 expect(mockSave).toHaveBeenCalledTimes(1);expect(mockSave.mock.calls[0][0].pageData.discovery_area).toBeUndefined();expect(mockSubmit).not.toHaveBeenCalled();
 expect(JSON.stringify(tree.toJSON())).toContain('Draft saved.');
 await act(async()=>action('Save and continue').props.onPress());
 expect(JSON.stringify(tree.toJSON())).not.toContain('Draft saved.');expect(JSON.stringify(tree.toJSON())).toContain('Choose an area in LA');
 expect(field('Name').props.value).toBe('Sunday Table');expect(mockSave).toHaveBeenCalledTimes(1);
});
it('persists deliberate classification choices and shows them in the private preview',async()=>{
 await mount();
 act(()=>tree.root.findByType(CommunityClassificationFields).props.onAreaChange('Many places around LA'));
 act(()=>tree.root.findByType(CommunityClassificationFields).props.onCategoriesChange(['art','music']));
 await act(async()=>action('Save and continue').props.onPress());
 expect(mockSave.mock.calls[0][0].pageData).toMatchObject({discovery_area:'Many places around LA',categories:['art','music']});
 expect(JSON.stringify(tree.toJSON())).toContain('Art · Music');expect(JSON.stringify(tree.toJSON())).toContain('Many places around LA');
});
it('keeps City required for organizations and does not show community classification',async()=>{
 data.record.kind='organization';data.record.pageData={name:'Sunday Table',purpose:'Bring neighbors together',city:'',audience:'everyone'};
 await mount();expect(tree.root.findAllByType(CommunityClassificationFields)).toHaveLength(0);
 await act(async()=>action('Save and continue').props.onPress());expect(mockSave).not.toHaveBeenCalled();expect(JSON.stringify(tree.toJSON())).toContain('City needs');
 act(()=>field('City').props.onChange('Los Angeles'));await act(async()=>action('Save and continue').props.onPress());expect(mockSave).toHaveBeenCalledTimes(1);
});
it('reveals the first missing community choice in the existing page scroller',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate','queueMicrotask']});delete data.record.pageData.discovery_area;data.record.pageData.categories=[];
 await mount();const scrollTo=jest.fn();tree.root.findByType(PageFrame).props.scrollRef.current={scrollTo};
 act(()=>tree.root.findByType(CommunityClassificationFields).props.areaGuidance.onLayout({nativeEvent:{layout:{y:640}}}));
 await act(async()=>action('Save and continue').props.onPress());await act(async()=>jest.advanceTimersByTimeAsync(32));
 expect(scrollTo).toHaveBeenCalledWith({y:624,animated:false});expect(mockSave).not.toHaveBeenCalled();
});
it('does not let new classification requirements block recovery of an already dispatched save',async()=>{
 delete data.record.pageData.discovery_area;delete data.record.pageData.categories;
 data.record.pending={kind:'save',expectedVersion:0,pageData:data.record.pageData};
 mockSave.mockImplementationOnce(async(r:any)=>({...r,version:1,pending:undefined}));await mount();
 await act(async()=>action('Retry save').props.onPress());expect(mockSave).toHaveBeenCalledTimes(1);
 expect(tree.root.findByType(CommunityClassificationFields)).toBeDefined();expect(action('Continue')).toBeUndefined();
});
it('ignores a retained classification change after the account visit retires',async()=>{
 await mount();const change=tree.root.findByType(CommunityClassificationFields).props.onAreaChange;mockCurrent=false;
 act(()=>change('Many places around LA'));expect(mockPersist).not.toHaveBeenCalled();
});
it('keeps a blank community City compatible with the LA launch without defaulting its Area',async()=>{
 data.record.pageData.city='';delete data.record.pageData.discovery_area;await mount();
 expect(tree.root.findByType(CommunityClassificationFields).props.area).toBeUndefined();
 await act(async()=>action('Save draft').props.onPress());expect(mockSave.mock.calls[0][0].pageData.city).toBe('Los Angeles');expect(mockSave.mock.calls[0][0].pageData.discovery_area).toBeUndefined();
});

const textLeaf=(value:string)=>tree.root.findAllByType(Text).find(node=>node.props.children===value)!;
const input=(label:string)=>tree.root.findAllByType(TextInput).find(node=>node.props.accessibilityLabel===label)!;
it('remeasures mounted page labels and validation without remounting typed inputs, the scroll view or controls',async()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try{
  await mount();act(()=>input('Name').props.onChangeText('My unfinished page'));
  const editor=tree.root.findByType(CreatorPageEditorScreen),name=input('Name'),purpose=input('What brings people together?'),scroll=tree.root.findAllByType(ScrollView)[0],save=action('Save and continue');
  const labels=['Create your page','Step 1 of 3 · Page details','Make it yours','Name','What brings people together?','Page photo','Next: preview your page'];
  let leaves=labels.map(textLeaf);mockPersist.mockClear();
  for(const fontScale of [1.35,1]){
   act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));
   labels.forEach((label,index)=>expect(textLeaf(label)).not.toBe(leaves[index]));leaves=labels.map(textLeaf);
   expect(tree.root.findByType(CreatorPageEditorScreen)).toBe(editor);expect(input('Name')).toBe(name);expect(input('What brings people together?')).toBe(purpose);
   expect(input('Name').props.value).toBe('My unfinished page');expect(tree.root.findAllByType(ScrollView)[0]).toBe(scroll);expect(action('Save and continue')).toBe(save);
   expect(mockPersist).not.toHaveBeenCalled();expect(mockSave).not.toHaveBeenCalled();expect(mockSubmit).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();
  }
  act(()=>input('Name').props.onChangeText(''));act(()=>action('Save and continue').props.onPress());
  const error='Page name needs 2–60 characters.';const alert=textLeaf(error),focusedInput=input('Name');
  act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1.35}}));
  expect(textLeaf(error)).not.toBe(alert);expect(input('Name')).toBe(focusedInput);expect(input('Name').props.value).toBe('');expect(mockSave).not.toHaveBeenCalled();
 }finally{act(()=>Dimensions.set({window:previous}));}
});
it('remeasures private preview copy through scale changes without changing its stage or saving again',async()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try{
  await mount();await act(async()=>action('Save and continue').props.onPress());
  const scroll=tree.root.findAllByType(ScrollView)[0],next=action('Continue');
  const labels=['Page preview','Step 2 of 3 · Preview','Sunday Table','Bring neighbors together','Santa Monica','Outdoors','Next: creator details'];let leaves=labels.map(textLeaf);
  for(const fontScale of [1.35,1]){
   act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));labels.forEach((label,index)=>expect(textLeaf(label)).not.toBe(leaves[index]));leaves=labels.map(textLeaf);
   expect(tree.root.findAllByType(ScrollView)[0]).toBe(scroll);expect(action('Continue')).toBe(next);expect(action('Submit for review')).toBeUndefined();expect(mockSave).toHaveBeenCalledTimes(1);expect(mockSubmit).not.toHaveBeenCalled();
  }
 }finally{act(()=>Dimensions.set({window:previous}));}
});
it('remeasures creator detail labels while keeping private answers, consent and every input mounted',async()=>{
 const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try{
  await mount();await act(async()=>action('Save and continue').props.onPress());act(()=>action('Continue').props.onPress());
  act(()=>input('Your name').props.onChangeText('Aster'));act(()=>input('Contact email').props.onChangeText('aster@example.invalid'));act(()=>input('Tell us what you have in mind').props.onChangeText('Keep our group welcoming'));
  const consent=tree.root.findAll(node=>node.props.accessibilityRole==='checkbox'&&typeof node.props.onPress==='function')[0];act(()=>consent.props.onPress());
  const inputs=tree.root.findAllByType(TextInput),scroll=tree.root.findAllByType(ScrollView)[0];
  const labels=['Introduce yourself','Step 3 of 3 · Creator details','Behind the page','Your name','Contact email','Tell us what you have in mind','How will you run and look after this space?','I’ll follow the creator and community guidelines.'];let leaves=labels.map(textLeaf);mockPersist.mockClear();
  for(const fontScale of [1.35,1]){
   act(()=>Dimensions.set({window:{...previous,width:390,fontScale}}));labels.forEach((label,index)=>expect(textLeaf(label)).not.toBe(leaves[index]));leaves=labels.map(textLeaf);
   tree.root.findAllByType(TextInput).forEach((node,index)=>expect(node).toBe(inputs[index]));expect(tree.root.findAllByType(ScrollView)[0]).toBe(scroll);
   expect(input('Your name').props.value).toBe('Aster');expect(input('Contact email').props.value).toBe('aster@example.invalid');expect(input('Tell us what you have in mind').props.value).toBe('Keep our group welcoming');
   expect(consent.props.accessibilityState.checked).toBe(true);expect(mockPersist).not.toHaveBeenCalled();expect(mockSubmit).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();
  }
 }finally{act(()=>Dimensions.set({window:previous}));}
});


it('retains committed save while a competing creator visit is uncommitted', async () => {
 const never = new Promise(() => {});
 function Pending({ suspend }: { suspend: boolean }) { if (suspend) throw never; return null; }
 const render = (suspend: boolean) => <React.Suspense fallback={null}><CreatorPageEditorScreen pageId={suspend ? 'other-page' : 'page'} /><Pending suspend={suspend} /></React.Suspense>;
 mockScopesByPage = { 'edit:page': mockScope, 'edit:other-page': { userId: mockScope.userId, isCurrent: () => true } };
 await act(async () => { tree = create(render(false)); });
 const save = action('Save draft')!.props.onPress;
 await act(async () => { React.startTransition(() => tree.update(render(true))); });
 expect(action('Save draft')!.props.onPress).toBe(save);
 await act(async () => save());
 expect(mockSave).toHaveBeenCalledTimes(1);
});

it('retains committed typing while another page render has no working record', async () => {
 const never = new Promise(() => {});
 function Pending({ suspend }: { suspend: boolean }) { if (suspend) throw never; return null; }
 const render = (suspend: boolean) => <React.Suspense fallback={null}><CreatorPageEditorScreen pageId={suspend ? 'other-page' : 'page'} /><Pending suspend={suspend} /></React.Suspense>;
 mockScopesByPage = { 'edit:page': mockScope, 'edit:other-page': { userId: mockScope.userId, isCurrent: () => true } };
 await act(async () => { tree = create(render(false)); });
 const nameInput = field('Name').findByType(TextInput);
 const type = nameInput.props.onChangeText;
 await act(async () => { React.startTransition(() => tree.update(render(true))); });
 expect(field('Name').findByType(TextInput)).toBe(nameInput);
 expect(nameInput.props.value).toBe('Sunday Table');
 await act(async () => type('A new name kept while typing'));
 expect(mockPersist).toHaveBeenCalledTimes(1);
 expect(mockPersist.mock.calls[0][0]).toMatchObject({ id: 'page', pageData: { name: 'A new name kept while typing' } });
 expect(field('Name').findByType(TextInput)).toBe(nameInput);
 expect(nameInput.props.value).toBe('A new name kept while typing');
 // A retained pre-edit callback cannot overwrite the now-committed newer text.
 await act(async () => type('Obsolete old callback'));
 expect(mockPersist).toHaveBeenCalledTimes(1);
 expect(nameInput.props.value).toBe('A new name kept while typing');
});

it('opts into committed focused-input reflow while wiring native blur and manual-scroll cancellation',async()=>{
 jest.useFakeTimers({doNotFake:['setImmediate']});const previous=Dimensions.get('window');act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));
 try{
  await mount();const name=input('Name'),scroll=tree.root.findAllByType(ScrollView)[0],scrollTo=jest.fn(),native={focus:jest.fn(),isFocused:()=>true};
  tree.root.findByType(PageFrame).props.scrollRef.current={scrollTo};field('Name').props.guidance.inputRef(native);act(()=>name.props.onFocus());
  act(()=>field('Name').props.guidance.onLayout({nativeEvent:{layout:{y:300}}}));
  act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1.35}}));act(()=>field('Name').props.guidance.onLayout({nativeEvent:{layout:{y:560}}}));await act(async()=>jest.advanceTimersByTimeAsync(32));
  expect(scrollTo).toHaveBeenLastCalledWith({y:544,animated:false});expect(input('Name')).toBe(name);expect(name.props.value).toBe('Sunday Table');expect(native.focus).not.toHaveBeenCalled();
  scrollTo.mockClear();act(()=>name.props.onBlur());act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1}}));act(()=>field('Name').props.guidance.onLayout({nativeEvent:{layout:{y:300}}}));await act(async()=>jest.advanceTimersByTimeAsync(32));expect(scrollTo).not.toHaveBeenCalled();
  act(()=>name.props.onFocus());act(()=>Dimensions.set({window:{...previous,width:390,fontScale:1.35}}));act(()=>field('Name').props.guidance.onLayout({nativeEvent:{layout:{y:560}}}));act(()=>scroll.props.onScrollBeginDrag());await act(async()=>jest.advanceTimersByTimeAsync(32));
  expect(scrollTo).not.toHaveBeenCalled();expect(native.focus).not.toHaveBeenCalled();expect(mockSave).not.toHaveBeenCalled();expect(mockSubmit).not.toHaveBeenCalled();
 }finally{act(()=>Dimensions.set({window:previous}));}
});

it('gives area search its own optional guidance key while keeping missing-area choice guidance separate',async()=>{
 await mount();const fields=tree.root.findByType(CommunityClassificationFields);
 expect(fields.props.areaSearchGuidance).toBeDefined();
 expect(fields.props.searchContentRef).toBe(tree.root.findByType(PageFrame).props.innerViewRef);
 expect(tree.root.findAllByType(ScrollView)[0].props.innerViewRef).toBe(fields.props.searchContentRef);
 expect(typeof fields.props.areaSearchGuidance.onBlur).toBe('function');
 expect(fields.props.areaSearchGuidance.inputRef).not.toBe(fields.props.areaGuidance.inputRef);
 const control=tree.root.findAll(node=>node.props.accessibilityLabel==='Area in LA: Santa Monica'&&typeof node.props.onPress==='function')[0];act(()=>control.props.onPress());
 const search=input('Search LA areas');expect(search.props.onFocus).toBe(fields.props.areaSearchGuidance.onFocus);expect(search.props.onBlur).toBe(fields.props.areaSearchGuidance.onBlur);
 expect(mockSave).not.toHaveBeenCalled();expect(mockSubmit).not.toHaveBeenCalled();
});


it('allows initial account-error Back to the creator directory without reading or writing a draft',async()=>{
 mockAccountError=Error('Account unavailable');await mount();act(()=>tree.root.findByType(PageFrame).props.onBack());
 expect(mockReplace).toHaveBeenCalledWith('/creator/pages');expect(mockLoad).not.toHaveBeenCalled();expect(mockSave).not.toHaveBeenCalled();expect(mockPersist).not.toHaveBeenCalled();expect(mockSubmit).not.toHaveBeenCalled();
});
it.each(['page','scope','unmount'] as const)('retires retained ordinary account-error Back after committed %s change',async change=>{
 mockAccountError=Error('Account unavailable');await mount();const back=tree.root.findByType(PageFrame).props.onBack;
 if(change==='page')await act(async()=>tree.update(<CreatorPageEditorScreen pageId="other-page"/>));
 else if(change==='scope'){mockAccountError=null;await act(async()=>tree.update(<CreatorPageEditorScreen pageId="page"/>));}
 else act(()=>tree.unmount());
 act(()=>back());expect(mockReplace).not.toHaveBeenCalled();
});


it.each(['blur','focus-roundtrip','epoch','synchronous-auth'] as const)('retires null-scope Back on %s ownership change',async change=>{
 mockAccountError=Error('Account unavailable');await mount();const back=tree.root.findByType(PageFrame).props.onBack;
 if(change==='synchronous-auth')mockCurrent=false;
 else if(change==='epoch'){mockEpoch++;await act(async()=>tree.update(<CreatorPageEditorScreen pageId="page"/>));}
 else{mockFocused=false;await act(async()=>tree.update(<CreatorPageEditorScreen pageId="page"/>));if(change==='focus-roundtrip'){mockFocused=true;await act(async()=>tree.update(<CreatorPageEditorScreen pageId="page"/>));}}
 act(()=>back());expect(mockReplace).not.toHaveBeenCalled();
});
