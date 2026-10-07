const mockRead = jest.fn(), mockSelect = jest.fn(), mockUpsert = jest.fn(), mockDelete = jest.fn(), mockEq = jest.fn();
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(() => ({ upsert: (...a: unknown[]) => mockUpsert(...a), delete: () => mockDelete() })) } }));
jest.mock('../communityChat', () => ({ ObsoleteCommunityOperationError: class extends Error {} }));
jest.mock('../communityRoomHistory', () => ({ getCommunityRoomIdentities: (...a: unknown[]) => mockRead(...a) }));
import { setOptionalRoomMembership } from '../communityOptionalRoom';
const scope = { userId: 'member', isCurrent: () => true };
const layout = (joined: boolean) => ({ communityId: 'page', name: 'Page', rooms: [
  { id: 'intro', storage: 'topic', role: 'intros', included: true, joined: true },
  { id: 'page', storage: 'broadcast', role: 'main', included: true, joined: true },
  { id: 'optional', storage: 'topic', role: 'optional', included: false, joined, notifications_on: false },
] });
beforeEach(() => {
  jest.clearAllMocks();
  const chain = { eq: (...a: unknown[]) => { mockEq(...a); return chain; }, select: (...a: unknown[]) => mockSelect(...a) };
  mockUpsert.mockReturnValue(chain); mockDelete.mockReturnValue(chain);
  mockSelect.mockResolvedValue({ data: [{ topic_id: 'optional', user_id: 'member' }], error: null });
  mockRead.mockResolvedValueOnce(layout(false)).mockResolvedValue(layout(true));
});
it('joins the exact current member without changing saved preference on a concurrent duplicate', async () => {
  mockSelect.mockResolvedValue({ data: [], error: null });
  expect(await setOptionalRoomMembership('page', 'optional', true, scope)).toEqual(layout(true));
  expect(mockUpsert).toHaveBeenCalledWith({ topic_id: 'optional', user_id: 'member' }, { onConflict: 'topic_id,user_id', ignoreDuplicates: true });
  expect(mockRead).toHaveBeenCalledTimes(2);
});
it('does not write when current membership already matches the requested state', async () => {
  mockRead.mockReset().mockResolvedValue(layout(true));
  await setOptionalRoomMembership('page', 'optional', true, scope);
  expect(mockUpsert).not.toHaveBeenCalled(); expect(mockDelete).not.toHaveBeenCalled();
});
it('leaves only the exact optional room and account and confirms the resulting membership', async () => {
  mockRead.mockReset().mockResolvedValueOnce(layout(true)).mockResolvedValue(layout(false));
  await setOptionalRoomMembership('page', 'optional', false, scope);
  expect(mockDelete).toHaveBeenCalledTimes(1); expect(mockEq.mock.calls).toEqual([['topic_id','optional'],['user_id','member']]);
});
it('rejects included rooms, event/absent topics and unmapped communities without writing', async () => {
  for (const id of ['intro','page','event']) await expect(setOptionalRoomMembership('page',id,false,scope)).rejects.toThrow('unavailable');
  mockRead.mockResolvedValue(null);
  await expect(setOptionalRoomMembership('page','optional',true,scope)).rejects.toThrow('unavailable');
  expect(mockUpsert).not.toHaveBeenCalled(); expect(mockDelete).not.toHaveBeenCalled();
});
it('does not dispatch after the initiating visit retires during preflight', async () => {
  let current=true;mockRead.mockReset().mockImplementation(async()=>{current=false;return layout(false);});
  await expect(setOptionalRoomMembership('page','optional',true,{...scope,isCurrent:()=>current})).rejects.toThrow();
  expect(mockUpsert).not.toHaveBeenCalled();
});
it('rejects another account receipt and never treats an empty receipt alone as success', async () => {
  mockSelect.mockResolvedValue({data:[{topic_id:'optional',user_id:'other'}],error:null});
  await expect(setOptionalRoomMembership('page','optional',true,scope)).rejects.toThrow('confirm');
  mockRead.mockReset().mockResolvedValue(layout(false));mockSelect.mockResolvedValue({data:[],error:null});
  await expect(setOptionalRoomMembership('page','optional',true,scope)).rejects.toThrow('confirm');
});
it('retains a failed mutation as uncertain without sending another write', async () => {
  mockSelect.mockRejectedValue(Error('Response lost'));
  await expect(setOptionalRoomMembership('page','optional',true,scope)).rejects.toThrow('Response lost');
  expect(mockUpsert).toHaveBeenCalledTimes(1);expect(mockRead).toHaveBeenCalledTimes(1);
});
