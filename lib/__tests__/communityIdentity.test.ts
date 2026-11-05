const mockSingle = jest.fn(), mockEq = jest.fn(), mockUpdate = jest.fn(), mockSelect = jest.fn(), mockFrom = jest.fn(), mockHeader = jest.fn(), mockSession = jest.fn();
jest.mock('../supabase', () => ({supabase:{from:(...args:unknown[])=>mockFrom(...args),auth:{getSession:(...args:unknown[])=>mockSession(...args)}}}));
import { updateCommunityIdentity } from '../communityBlocks';
const fields = {name:'Sunday walks',purpose:'Weekly walks around the neighborhood'};
let live: boolean;
const scope = {userId:'alice',isCurrent:()=>live};
beforeEach(()=>{
  jest.clearAllMocks();live=true;
  mockFrom.mockReturnValue({update:mockUpdate});mockUpdate.mockReturnValue({eq:mockEq});
  mockEq.mockReturnValue({select:mockSelect});mockSelect.mockReturnValue({single:mockSingle});
  mockSingle.mockReturnValue({setHeader:mockHeader});
  mockSession.mockResolvedValue({data:{session:{user:{id:'alice'},access_token:'test-token'}},error:null});
});
it('requires the exact saved identity from the requested community',async()=>{
  mockHeader.mockResolvedValue({data:{id:'community',...fields},error:null});
  await expect(updateCommunityIdentity('community',fields,scope)).resolves.toBeUndefined();
  expect(mockFrom).toHaveBeenCalledWith('communities');expect(mockUpdate).toHaveBeenCalledWith(fields);
  expect(mockEq).toHaveBeenCalledWith('id','community');expect(mockSelect).toHaveBeenCalledWith('id, name, purpose');
  expect(mockHeader).toHaveBeenCalledWith('Authorization','Bearer test-token');
});
it.each([null,{}, {id:'other',...fields}, {id:'community',...fields,name:'Old name'}, {id:'community',...fields,purpose:'Old description'}])('does not treat an absent or mismatched write receipt as saved (%j)',async data=>{
  mockHeader.mockResolvedValue({data,error:null});
  await expect(updateCommunityIdentity('community',fields,scope)).rejects.toThrow('Couldn’t confirm');
});
it('surfaces a rejected write without claiming success',async()=>{
  mockHeader.mockResolvedValue({data:null,error:{code:'42501',message:'permission denied for table communities'}});
  await expect(updateCommunityIdentity('community',fields,scope)).rejects.toThrow('Your edits are still here.');
});
it('does not write under a changed account',async()=>{
  mockSession.mockResolvedValue({data:{session:{user:{id:'bob'},access_token:'other-test-token'}},error:null});
  await expect(updateCommunityIdentity('community',fields,scope)).rejects.toThrow();expect(mockFrom).not.toHaveBeenCalled();
});
it('does not dispatch after leaving during the session check',async()=>{
  mockSession.mockImplementation(async()=>{live=false;return {data:{session:{user:{id:'alice'},access_token:'test-token'}},error:null};});
  await expect(updateCommunityIdentity('community',fields,scope)).rejects.toThrow();expect(mockFrom).not.toHaveBeenCalled();
});
it('does not confirm a result after the editing visit has ended',async()=>{
  mockHeader.mockImplementation(async()=>{live=false;return {data:{id:'community',...fields},error:null};});
  await expect(updateCommunityIdentity('community',fields,scope)).rejects.toThrow();
});
