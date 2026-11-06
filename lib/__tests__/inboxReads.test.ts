import { readInboxInvitations, readInboxNotifications } from '../inboxReads';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
const scope = { userId: 'alex', isCurrent: jest.fn(() => true) };
const responses = new Map<string, () => Promise<any>>();
const picnic = { id:'invite', event_id:'plan', sender_id:'sender', events:{status:'active',title:'Picnic'} };
const notice = {id:'notice',type:'member_joined', actor_user_id:'sender'};
beforeEach(() => {
  scope.isCurrent.mockReset().mockReturnValue(true);
  responses.clear();
  jest.mocked(supabase.rpc).mockResolvedValue({data:null,error:null} as never);
  jest.mocked(supabase.from).mockImplementation((table:string) => {
    const chain:any = { then:(ok:any,no:any) => responses.get(table)!().then(ok,no) };
    for (const key of ['select','eq','neq','in','or','order','limit']) chain[key] = () => chain;
    return chain;
  });
});
it.each([[readInboxInvitations,'plan_invites'],[readInboxNotifications,'app_notifications']] as const)(
  'distinguishes a disconnect, access denial and a confirmed empty list', async(read,table)=>{
    responses.set(table,async()=>({data:null,error:{message:'TypeError: Network request failed'}}));
    await expect(read(scope)).rejects.toMatchObject({message:expect.stringContaining('Network')});
    responses.set(table,async()=>({data:null,error:{code:'42501',message:'permission denied'}}));
    expect(await read(scope)).toBeNull();
    responses.set(table,async()=>({data:[],error:null}));
    expect(await read(scope)).toEqual([]);
});
it('keeps primary results if profile photos or the optional expiry cleanup are unavailable',async()=>{
  let finishCleanup!: () => void;
  jest.mocked(supabase.rpc).mockImplementation(()=>new Promise<void>(resolve=>{finishCleanup=resolve;}) as never);
  responses.set('profiles_public',async()=>{throw Error('offline');});
  responses.set('plan_invites',async()=>({data:[picnic,{...picnic,events:{status:'cancelled'}}],error:null}));
  responses.set('app_notifications',async()=>({data:[notice],error:null}));
  expect(await readInboxInvitations(scope)).toEqual([{...picnic,profiles:null}]);
  expect(await readInboxNotifications(scope)).toEqual([{...notice,scene_update:false,sender_photo:null}]);
  finishCleanup();
});
it('drops a result if the account changes during sender enrichment',async()=>{
  responses.set('plan_invites',async()=>({data:[picnic],error:null}));
  responses.set('profiles_public',async()=>{scope.isCurrent.mockReturnValue(false);return {data:[],error:null};});
  expect(await readInboxInvitations(scope)).toBeNull();
});
