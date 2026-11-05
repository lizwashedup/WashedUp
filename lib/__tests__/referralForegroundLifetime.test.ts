const mockStore = new Map<string,string>();
const mockSession = jest.fn(), mockClaim = jest.fn(), mockHeader = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({
 getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
 setItem: jest.fn(async (k: string,v: string) => {mockStore.set(k,v);}), removeItem: jest.fn(async (k:string) => {mockStore.delete(k);}),
}));
jest.mock('../supabase', () => ({supabase:{auth:{getSession:()=>mockSession()},rpc:(...a:any[])=>{
 const promise=Promise.resolve(mockClaim(...a));return Object.assign(promise,{setHeader:(...h:any[])=>{mockHeader(...h);return promise;}});
}}}));
import {handleReferralUrl} from '../yours/referralLink';
const url=(code:string)=>`https://washedup.app/r/${code}`;
const session={data:{session:{user:{id:'account-a'},access_token:'fictional-token'}},error:null};
const signedOut={data:{session:null},error:null};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return{promise,resolve};};
const scoped=(u:string,current:()=>boolean)=>(handleReferralUrl as any)(u,{isCurrent:current});
beforeEach(()=>{jest.clearAllMocks();mockStore.clear();mockSession.mockReset().mockResolvedValue(session);mockClaim.mockReset().mockResolvedValue({data:'11111111-1111-4111-8111-111111111111',error:null});});
afterEach(()=>jest.useRealTimers());
it('preserves a newer signed-out invite when an older session read arrives late',async()=>{
 const older=deferred();mockSession.mockReturnValueOnce(older.promise).mockResolvedValueOnce(signedOut);
 const first=handleReferralUrl(url('FIRST'));await handleReferralUrl(url('NEW'));older.resolve(signedOut);await first;
 expect(JSON.parse(mockStore.get('pendingReferral.v1')!).code).toBe('NEW');
});
it('does not send a claim after its root/account lifetime retires during a session read',async()=>{
 let active=true;const read=deferred();mockSession.mockReturnValueOnce(read.promise);
 const handled=scoped(url('FIRST'),()=>active);active=false;read.resolve(session);await handled;
 expect(mockClaim).not.toHaveBeenCalled();
});
it('ignores an older signed-in referral after a newer link arrives',async()=>{
 const read=deferred();mockSession.mockReturnValueOnce(read.promise);
 const old=handleReferralUrl(url('OLD'));await handleReferralUrl(url('NEW'));read.resolve(session);await old;
 expect(mockClaim).toHaveBeenCalledTimes(1);expect(mockClaim).toHaveBeenCalledWith('claim_referral_invite',{p_code:'NEW'});
});
it('keeps a session error distinct from signed out',async()=>{
 mockSession.mockResolvedValueOnce({data:{session:null},error:{message:'offline'}});await handleReferralUrl(url('FIRST'));
 expect(mockStore.size).toBe(0);expect(mockClaim).not.toHaveBeenCalled();
});
it('still accepts a current signed-in invite',async()=>{await handleReferralUrl(url('FIRST'));expect(mockClaim).toHaveBeenCalledWith('claim_referral_invite',{p_code:'FIRST'});});

it('pins the current claim token after its recipient is rechecked',async()=>{
 await handleReferralUrl(url('FIRST'));expect(mockHeader).toHaveBeenCalledWith('Authorization','Bearer fictional-token');
});
it('does not dispatch if the fresh session has switched recipients',async()=>{
 mockSession.mockResolvedValueOnce(session).mockResolvedValueOnce({data:{session:{user:{id:'account-b'},access_token:'fictional-other'}},error:null});
 await handleReferralUrl(url('FIRST'));expect(mockClaim).not.toHaveBeenCalled();
});
it('bounds a stalled session and ignores its eventual value',async()=>{
 jest.useFakeTimers();const read=deferred();mockSession.mockReturnValueOnce(read.promise);
 const handled=handleReferralUrl(url('FIRST'));await flush();await jest.advanceTimersByTimeAsync(12_001);await expect(handled).resolves.toBe(true);
 read.resolve(session);await flush();expect(mockClaim).not.toHaveBeenCalled();
});
it('does not start a read for a retired delivery scope',async()=>{
 await scoped(url('FIRST'),()=>false);expect(mockSession).not.toHaveBeenCalled();
});
it('does not claim after scope retirement during the fresh recipient read',async()=>{
 let active=true;const read=deferred();mockSession.mockResolvedValueOnce(session).mockReturnValueOnce(read.promise);
 const handled=scoped(url('FIRST'),()=>active);await flush();active=false;read.resolve(session);await handled;
 expect(mockClaim).not.toHaveBeenCalled();
});
