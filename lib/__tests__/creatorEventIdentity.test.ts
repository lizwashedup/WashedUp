import { loadSavedEventOrganizer } from '../creatorEventIdentity';
import { supabase } from '../supabase';
import { loadManagedOrganizationName } from '../creatorManagement';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), auth: {getSession: jest.fn()} } }));
jest.mock('../creatorManagement', () => ({ loadManagedOrganizationName: jest.fn() }));

const id = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const other = '30000000-0000-4000-8000-000000000003';
const scope = { userId, isCurrent: () => true };
const readName = jest.mocked(loadManagedOrganizationName);
const from = jest.mocked(supabase.from);
function row(data: unknown, error: unknown = null) {
  const query = {select:jest.fn(),eq:jest.fn(),maybeSingle:jest.fn(),setHeader:jest.fn().mockResolvedValue({data,error})};
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.maybeSingle.mockReturnValue(query);
  from.mockReturnValueOnce(query as never);
  return query;
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(supabase.auth.getSession).mockResolvedValue({data:{session:{user:{id:userId},access_token:'fixture-token'}},error:null} as never);
});
it('names the organization that owns the draft, ignoring an editable listing name', async () => {
  const query = row({id,owner_type:'organization',owner_user_id:userId,public_name:'Sunday DJ booth'});
  readName.mockResolvedValue('Local Sunset Events');
  await expect(loadSavedEventOrganizer(id,scope)).resolves.toBe('Local Sunset Events');
  expect(query.eq).toHaveBeenCalledWith('id', id);
  expect(query.setHeader).toHaveBeenCalledWith('Authorization','Bearer fixture-token');
});
it('does not substitute the current organization for another owner', async () => {
  row({id,owner_type:'organization',owner_user_id:other});
  await expect(loadSavedEventOrganizer(id,scope)).resolves.toBe('Organization event');
  expect(readName).not.toHaveBeenCalled();
});
it('looks up the saved community, independently of any selected workspace', async () => {
  row({id,owner_type:'community',owner_community_id:other});
  const community = row({id:other,name:'Local Sunset Club'});
  await expect(loadSavedEventOrganizer(id,scope)).resolves.toBe('Local Sunset Club');
  expect(community.eq).toHaveBeenCalledWith('id',other);
  expect(community.setHeader).toHaveBeenCalledWith('Authorization','Bearer fixture-token');
});
it('does not guess an organizer after an inaccessible or mismatched row', async () => {
  row(null,{code:'42501'});row({id:other,owner_type:'platform'});
  await expect(loadSavedEventOrganizer(id,scope)).rejects.toThrow('unavailable');
  await expect(loadSavedEventOrganizer(id,scope)).rejects.toThrow('unavailable');
});
it('retires an owner read if the signed-in account changes', async () => {
  jest.mocked(supabase.auth.getSession).mockResolvedValue({data:{session:{user:{id:other},access_token:'other-token'}},error:null} as never);
  await expect(loadSavedEventOrganizer(id,scope)).rejects.toThrow();
  expect(from).not.toHaveBeenCalled();
});
