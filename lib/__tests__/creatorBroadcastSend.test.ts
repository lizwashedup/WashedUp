const mockGetUser = jest.fn(), mockSession = jest.fn(), mockFrom = jest.fn();
jest.mock('../supabase', () => ({supabase:{auth:{getUser:mockGetUser,getSession:mockSession},from:mockFrom}}));
jest.mock('../viewAs', () => ({isViewingAsEventHost:()=>false}));
const { sendBroadcast, checkBroadcast } = require('../creatorMode');
const id='11111111-1111-4111-8111-111111111111';
const scope=()=>({userId:'creator',isCurrent:()=>true});
let membership: any[], insertResult: any, readResult: any, requests: any[];
const receipt=()=>({id,community_id:'sunset',sender_id:'creator',kind:'broadcast',body:'Picnic on Sunday'});
beforeEach(()=>{
 jest.clearAllMocks();requests=[];membership=[{role:'leader',communities:{id:'sunset',status:'active'}}];insertResult={error:null};readResult={data:null,error:null};
 mockGetUser.mockResolvedValue({data:{user:{id:'creator'}},error:null});
 mockSession.mockResolvedValue({data:{session:{user:{id:'creator'},access_token:'owned-token'}},error:null});
 mockFrom.mockImplementation((table:string)=>{
  const request:any={table,inserted:false};const chain:any={};
  for(const method of ['select','eq','neq','in','order','maybeSingle','abortSignal','setHeader'])chain[method]=jest.fn(()=>chain);
  chain.insert=jest.fn((payload:any)=>{request.inserted=true;request.payload=payload;return chain;});
  chain.then=(resolve:any,reject:any)=>Promise.resolve(table==='community_members'?{data:membership,error:null}:table==='operator_grants'?{data:[],error:null}:request.inserted?insertResult:readResult).then(resolve,reject);
  request.chain=chain;requests.push(request);return chain;
 });
});
it('sends to the exact community with its saved ID and initiating account token',async()=>{
 await sendBroadcast('sunset',' Picnic on Sunday ',scope(),id);
 const write=requests.find(r=>r.inserted);expect(write.payload).toEqual({...receipt(),body:'Picnic on Sunday'});
 expect(write.chain.setHeader).toHaveBeenCalledWith('Authorization','Bearer owned-token');
});
it('recovers a lost response by reading the same update without a second insert',async()=>{
 insertResult={error:Error('lost response')};readResult={data:receipt(),error:null};await expect(sendBroadcast('sunset','Picnic on Sunday',scope(),id)).resolves.toBeUndefined();
 expect(requests.filter(r=>r.inserted)).toHaveLength(1);
});
it('does not confirm a different body or community as the original update',async()=>{
 readResult={data:{...receipt(),body:'Different'},error:null};await expect(checkBroadcast('sunset','Picnic on Sunday',scope(),id)).rejects.toThrow('could not be confirmed');
 expect(requests.some(r=>r.inserted)).toBe(false);
});
it('keeps unknown results distinct from a confirmed post',async()=>{
 insertResult={error:Error('connection lost')};await expect(sendBroadcast('sunset','Picnic on Sunday',scope(),id)).rejects.toThrow('connection lost');
 await expect(checkBroadcast('sunset','Picnic on Sunday',scope(),id)).resolves.toBe(false);
});
it('does not borrow leadership from another community',async()=>{
 membership=[{role:'events',communities:{id:'sunset'}},{role:'leader',communities:{id:'other'}}];
 await expect(sendBroadcast('sunset','Picnic on Sunday',scope(),id)).rejects.toThrow('permission');expect(requests.some(r=>r.inserted)).toBe(false);
});
it('blocks a changed account before dispatch',async()=>{
 mockSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'other-token'}},error:null});
 await expect(sendBroadcast('sunset','Picnic on Sunday',scope(),id)).rejects.toThrow('account changed');expect(requests.some(r=>r.inserted)).toBe(false);
});
it('retires a pending account check before it can send',async()=>{
 let resolve!:(v:any)=>void;mockSession.mockReturnValue(new Promise(r=>{resolve=r;}));const owned=scope();const operation=sendBroadcast('sunset','Picnic on Sunday',owned,id);
 const result=expect(operation).rejects.toThrow('visit has changed');while(!mockSession.mock.calls.length)await Promise.resolve();owned.isCurrent=()=>false;
 resolve({data:{session:{user:{id:'creator'},access_token:'owned-token'}},error:null});await result;expect(requests.some(r=>r.inserted)).toBe(false);
});
it('bounds a stalled preflight and never dispatches when that read eventually finishes',async()=>{
 jest.useFakeTimers();let resolve!:(v:any)=>void;mockGetUser.mockReturnValue(new Promise(r=>{resolve=r;}));
 const result=expect(sendBroadcast('sunset','Picnic on Sunday',scope(),id)).rejects.toThrow('too long');
 await jest.advanceTimersByTimeAsync(12_000);await result;
 resolve({data:{user:{id:'creator'}},error:null});await Promise.resolve();await Promise.resolve();
 expect(requests.some(r=>r.inserted)).toBe(false);jest.useRealTimers();
});
