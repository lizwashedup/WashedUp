const mockStorage = new Map<string,string>(); const mockGet = jest.fn(), mockSet = jest.fn(), mockUUID = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: (...a: unknown[]) => mockGet(...a), setItem: (...a: unknown[]) => mockSet(...a) } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => mockUUID() }));
import { readPageTeamState, savePageTeamDraft, preparePageTeamCreation, preparePageTeamResponse, clearPageTeamOperation } from '../creatorPageTeamAttempt';
import type { PageTeamPermission, PageTeamInvitation } from '../creatorPageTeam';
const page='774c2329-e22e-4113-8a2a-67ca854dd2c9', owner='0e6e1827-0f87-4e03-b42b-7ade8219725b', recipient='753c5b17-ca8d-431f-ad8f-0d9b70c0dccb', id='0f710000-0000-4000-8000-000000000001';
const scope={userId:owner,isCurrent:()=>true}, draft={permissions:['page_content'] as PageTeamPermission[],handle:'known_person',note:'Hello',person:{pageId:page,userId:recipient,name:'Cedar',photoUrl:null}};
const invitation={pageId:page,invitationId:id,pageKind:'community',pageName:'Community',inviterId:owner,recipientId:recipient,role:'co_creator',status:'pending',note:'Hello'} as PageTeamInvitation;
beforeEach(()=>{jest.resetAllMocks();mockStorage.clear();mockUUID.mockReturnValue(id);mockGet.mockImplementation(async k=>mockStorage.get(k)??null);mockSet.mockImplementation(async(k,v)=>{mockStorage.set(k,v);});});
it('persists the draft and exact operation before returning dispatchable work',async()=>{
 await savePageTeamDraft(page,draft,scope);const result=await preparePageTeamCreation(page,recipient,' Hello ',scope,['page_content']);
 expect(result).toMatchObject({created:true,operation:{operationId:id,pageId:page,recipientId:recipient,note:'Hello'}});
 expect(await readPageTeamState(page,scope)).toMatchObject({draft,operation:result.operation});
});
it('serializes simultaneous preparations and does not retarget existing work',async()=>{
 const pair=await Promise.all([preparePageTeamCreation(page,recipient,'First',scope,['page_content']),preparePageTeamCreation(page,recipient,'Second',scope,['page_content'])]);
 expect(pair.map(p=>p.created)).toEqual([true,false]);expect(pair[0].operation).toEqual(pair[1].operation);expect(mockUUID).toHaveBeenCalledTimes(1);
});
it('keeps persisted uncertain preparation after the storage response is lost',async()=>{
 mockSet.mockImplementationOnce(async(k,v)=>{mockStorage.set(k,v);throw Error('Lost storage response');});
 await expect(preparePageTeamCreation(page,recipient,'Original',scope,['page_content'])).rejects.toThrow();
 expect(await preparePageTeamCreation(page,recipient,'Changed',scope,['page_content'])).toMatchObject({created:false,operation:{note:'Original'}});expect(mockUUID).toHaveBeenCalledTimes(1);
});
it('does not replace pending recovery when the draft is edited',async()=>{
 await preparePageTeamCreation(page,recipient,'Original',scope,['page_content']);
 await expect(savePageTeamDraft(page,draft,scope)).rejects.toThrow('pending invitation');expect((await readPageTeamState(page,scope)).operation).toMatchObject({note:'Original'});
});
it('isolates accounts and pages and clears only an exact confirmed operation',async()=>{
 const {operation}=await preparePageTeamCreation(page,recipient,'Hello',scope,['page_content']);
 expect((await readPageTeamState(page,{...scope,userId:recipient})).operation).toBeNull();
 await clearPageTeamOperation({...operation,operationId:recipient},scope);expect((await readPageTeamState(page,scope)).operation).not.toBeNull();
 await clearPageTeamOperation(operation,scope);expect((await readPageTeamState(page,scope)).operation).toBeNull();
});
it('preserves a recipient action independently from owner drafts',async()=>{
 const rs={...scope,userId:recipient};const {operation}=await preparePageTeamResponse(invitation,'decline',rs);
 expect((await readPageTeamState(page,rs)).operation).toEqual(operation);expect((await readPageTeamState(page,scope)).operation).toBeNull();
 await expect(preparePageTeamResponse(invitation,'accept',scope)).rejects.toThrow('unavailable');
});
it('rejects retired visits and corrupt stored identity without overwriting data',async()=>{
 await expect(preparePageTeamCreation(page,recipient,'Hello',{...scope,isCurrent:()=>false})).rejects.toThrow();expect(mockSet).not.toHaveBeenCalled();
 mockGet.mockResolvedValue(JSON.stringify({version:1,pageId:recipient,userId:owner,draft,operation:null}));await expect(preparePageTeamCreation(page,recipient,'Hello',scope,['page_content'])).rejects.toThrow();expect(mockSet).not.toHaveBeenCalled();
});
it('late cleanup from a retired visit cannot erase saved recovery',async()=>{
 const {operation}=await preparePageTeamCreation(page,recipient,'Hello',scope,['page_content']);
 await expect(clearPageTeamOperation(operation,{...scope,isCurrent:()=>false})).rejects.toThrow();expect((await readPageTeamState(page,scope)).operation).toEqual(operation);
});

import { preparePageTeamAccess } from '../creatorPageTeamAttempt';
it('starts invitations with no preselected permissions and preserves old unsent drafts safely',async()=>{
 expect((await readPageTeamState(page,scope)).draft.permissions).toEqual([]);
 const {permissions,...oldDraft}=draft;mockStorage.set(`creator-page-team:v1:${owner}:${page}`,JSON.stringify({version:1,pageId:page,userId:owner,draft:oldDraft,operation:null}));
 expect((await readPageTeamState(page,scope)).draft.permissions).toEqual([]);
 await expect(preparePageTeamCreation(page,recipient,'Hello',scope)).rejects.toThrow();
});
it('does not clear a pending invitation when permission identity differs',async()=>{
 const {operation}=await preparePageTeamCreation(page,recipient,'Hello',scope,['page_content']);
 if(operation.kind!=='create')throw Error('Wrong fixture');
 expect(await clearPageTeamOperation({...operation,permissions:['page_events']},scope)).toBe(false);
 expect((await readPageTeamState(page,scope)).operation).toEqual(operation);
});
it('persists exact versioned owner access changes before dispatch and retains original choice',async()=>{
 const assignment={assignmentId:id,userId:recipient,invitationId:id,acceptedAt:'2026-09-15T01:00:00Z',role:'co_creator' as const,available:true,name:'Cedar',permissions:['page_content'] as PageTeamPermission[],revision:1,revokedAt:null};
 const first=await preparePageTeamAccess(page,assignment,'edit',['page_events'],scope);
 const second=await preparePageTeamAccess(page,assignment,'revoke',[],scope);
 expect(first.created).toBe(true);expect(second.created).toBe(false);expect(second.operation).toEqual(first.operation);
 expect((await readPageTeamState(page,scope)).operation).toEqual(first.operation);
 if(first.operation.kind!=='access')throw Error('Wrong fixture');
 expect(await clearPageTeamOperation({...first.operation,assignment:{...assignment,revision:2}},scope)).toBe(false);
});
