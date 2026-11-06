import { QueryClient } from '@tanstack/react-query';
import { addPeopleWithReceipt, IncompleteCircleAdd, pendingCircleAdd, UnknownCircleAdd } from '../circles/addPeopleReceipt';

const mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
const current = () => {};
let client: QueryClient;
const selected = ['amelia', 'jo'];
const people = (...ids: string[]) => ({data:{circle:{id:'circle'},members:ids.map(user_id => ({user_id}))},error:null});
function run(checkOnly = false, ids = selected) {
  return addPeopleWithReceipt(client, 'alice', 'circle', ids, current, checkOnly);
}
beforeEach(() => { client = new QueryClient(); mockRpc.mockReset(); });
it('recovers the entire intended membership after a lost response', async () => {
  mockRpc.mockRejectedValueOnce(Error('lost')).mockResolvedValueOnce(people('jo','unrelated','alice','amelia'));
  await expect(run()).resolves.toBe(0);
  expect(mockRpc.mock.calls.map(call => call[0])).toEqual(['invite_to_circle','get_circle']);
});
it('retains unresolved recipients across visits and other accounts cannot consume that decision', async () => {
  mockRpc.mockRejectedValueOnce(Error('lost')).mockResolvedValueOnce(people('amelia','jo'));
  await expect(run()).rejects.toBeInstanceOf(UnknownCircleAdd);
  expect(pendingCircleAdd(client,'alice','circle')).toEqual(selected);
  expect(pendingCircleAdd(client,'bob','circle')).toBeUndefined();
  await expect(run(false,['new-target'])).rejects.toBeInstanceOf(UnknownCircleAdd);
  expect(mockRpc).toHaveBeenCalledTimes(2);
  mockRpc.mockResolvedValueOnce(people('alice','jo'));
  await expect(run(true)).rejects.toMatchObject({missing:['amelia'],joined:['jo']});
  expect(pendingCircleAdd(client,'alice','circle')).toBeUndefined();
  mockRpc.mockResolvedValueOnce({data:1,error:null});
  await run(false,['amelia']);
  expect(mockRpc.mock.calls[3]).toEqual(['invite_to_circle',{p_circle_id:'circle',p_user_ids:['amelia']}]);
});
it('keeps an uncertain result after the initiating sheet closes during a dispatched write', async () => {
  let active=true;
  mockRpc.mockImplementationOnce(async()=>{active=false;throw Error('lost');});
  await expect(addPeopleWithReceipt(client,'alice','circle',selected,()=>{if(!active)throw Error('retired');},false)).rejects.toThrow('retired');
  mockRpc.mockResolvedValueOnce(people('alice'));
  await expect(run(true)).rejects.toBeInstanceOf(IncompleteCircleAdd);
  expect(mockRpc.mock.calls.filter(call=>call[0]==='invite_to_circle')).toHaveLength(1);
});
it.each([0,1,2])('keeps a confirmed changed-row count of %i', async count => {
  mockRpc.mockResolvedValueOnce({data:count,error:null});
  await expect(run()).resolves.toBe(count); expect(mockRpc).toHaveBeenCalledTimes(1);
});
