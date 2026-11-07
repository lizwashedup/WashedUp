import { getMyTopicMembership } from '../eventTopicMembership';
import { hasLegacyTopicJoin, joinLegacyTopicWithReceipt, LegacyTopicJoinUnconfirmed } from '../legacyTopicJoinReceipt';
const mockWrite=jest.fn();
let mockDispatch=true;
jest.mock('../communityChat',()=>({joinTopic:(...args:any[])=>{if(mockDispatch)args[2]?.();return mockWrite(...args)}}));
jest.mock('../eventTopicMembership',()=>({getMyTopicMembership:jest.fn()}));
const join=mockWrite, read=jest.mocked(getMyTopicMembership);
let client:object, alive:boolean;
const scope={userId:'alice',isCurrent:()=>alive};
const run=()=>joinLegacyTopicWithReceipt(client,'community','topic',scope);
const pending=()=>hasLegacyTopicJoin(client,'alice','community','topic');
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes});return{resolve,promise};}
beforeEach(()=>{jest.resetAllMocks();client={};alive=true;mockDispatch=true;join.mockResolvedValue();read.mockResolvedValue(false);});
afterEach(()=>jest.useRealTimers());
it('opens after the documented successful insert response',async()=>{await run();expect(join).toHaveBeenCalledTimes(1);expect(read).not.toHaveBeenCalled();expect(pending()).toBe(false);});
it('recovers a lost response from the exact own membership without another write',async()=>{
 join.mockRejectedValueOnce(Error('lost'));read.mockResolvedValueOnce(true);await run();expect(join).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledWith('topic',scope);expect(pending()).toBe(false);
});
it.each([false,undefined])('does not retry an uncertain write when a status read returns %s',async value=>{
 join.mockRejectedValueOnce(Error('lost'));read.mockResolvedValue(value as boolean);
 await expect(run()).rejects.toBeInstanceOf(LegacyTopicJoinUnconfirmed);
 await expect(run()).rejects.toBeInstanceOf(LegacyTopicJoinUnconfirmed);
 expect(join).toHaveBeenCalledTimes(1);expect(pending()).toBe(true);
});
it('retains recovery after an offline status check, then opens on explicit Check',async()=>{
 join.mockRejectedValueOnce(Error('lost'));read.mockRejectedValueOnce(Error('offline'));
 await expect(run()).rejects.toBeInstanceOf(LegacyTopicJoinUnconfirmed);
 read.mockResolvedValueOnce(true);await run();expect(join).toHaveBeenCalledTimes(1);expect(pending()).toBe(false);
});
it('bounds a held write, never repeats it on reentry, and recovers its eventual membership',async()=>{
 jest.useFakeTimers();const wait=deferred();join.mockReturnValueOnce(wait.promise);
 const work=expect(run()).rejects.toBeInstanceOf(LegacyTopicJoinUnconfirmed);
 await jest.advanceTimersByTimeAsync(12_001);await work;
 expect(pending()).toBe(true);expect(join.mock.calls[0][1]!.isCurrent()).toBe(false);
 await expect(run()).rejects.toBeInstanceOf(LegacyTopicJoinUnconfirmed);expect(join).toHaveBeenCalledTimes(1);
 wait.resolve();await Promise.resolve();await Promise.resolve();read.mockResolvedValueOnce(true);await run();expect(join).toHaveBeenCalledTimes(1);
});
it('a positive read while the write remains pending cannot clear its ownership',async()=>{
 jest.useFakeTimers();const wait=deferred();join.mockReturnValueOnce(wait.promise);read.mockResolvedValue(true);
 const work=run();await jest.advanceTimersByTimeAsync(12_001);await work;expect(pending()).toBe(true);
 read.mockResolvedValue(false);await expect(run()).rejects.toBeInstanceOf(LegacyTopicJoinUnconfirmed);expect(join).toHaveBeenCalledTimes(1);wait.resolve();
});
it('allows an explicit later retry after a definite refusal',async()=>{
 join.mockRejectedValueOnce({code:'42501'});await expect(run()).rejects.toEqual({code:'42501'});expect(pending()).toBe(false);await run();expect(join).toHaveBeenCalledTimes(2);
});
it('retired success never resumes navigation and is rechecked on another visit',async()=>{
 const wait=deferred();join.mockReturnValueOnce(wait.promise);const work=expect(run()).rejects.toThrow('visit changed');alive=false;wait.resolve();await work;
 expect(pending()).toBe(true);alive=true;await expect(run()).rejects.toBeInstanceOf(LegacyTopicJoinUnconfirmed);expect(join).toHaveBeenCalledTimes(1);
});
it('separates account and topic identities and rejects a retired check',async()=>{
 join.mockRejectedValueOnce(Error('lost'));await expect(run()).rejects.toBeInstanceOf(LegacyTopicJoinUnconfirmed);
 expect(hasLegacyTopicJoin(client,'bob','community','topic')).toBe(false);expect(hasLegacyTopicJoin(client,'alice','community','other')).toBe(false);
 alive=false;await expect(run()).rejects.toThrow('visit changed');expect(read).toHaveBeenCalledTimes(1);
});

it('permits retry after a failed identity lookup that never dispatched a write',async()=>{
 mockDispatch=false;join.mockRejectedValueOnce(Error('identity offline'));
 await expect(run()).rejects.toThrow('identity offline');expect(pending()).toBe(false);expect(read).not.toHaveBeenCalled();
 mockDispatch=true;await run();expect(join).toHaveBeenCalledTimes(2);
});
