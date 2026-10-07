import AsyncStorage from '@react-native-async-storage/async-storage';
const mockUser = jest.fn(), mockRpc = jest.fn(), mockFrom = jest.fn();
let mockId = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++mockId).padStart(12, '0')}` }));
jest.mock('../supabase', () => ({ supabase: { auth: { getUser: () => mockUser() }, rpc: (...a: unknown[]) => mockRpc(...a), from: (...a: unknown[]) => mockFrom(...a) } }));
import { preparePageUpdate, readPendingPageUpdate, sendPageUpdate, checkPageUpdate, resolvePageUpdate,
  editPreparedPageUpdate, readRecentPageUpdates, type PageUpdateAttempt } from '../creatorPageUpdates';
const page = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
const scope = { userId: user, isCurrent: () => true };
const marker = `creator-page-update:v1:${user}:${page}`;
const receipt = (a: PageUpdateAttempt) => ({ id: a.id, page_id: a.pageId, sender_user_id: a.userId,
  body: a.body, created_at: '2026-09-15T04:00:00Z', queued_recipient_count: 2 });
const row = (a: PageUpdateAttempt) => ({ ...receipt(a), creator_page_id: a.pageId });
const queryCalls: Array<[string, ...unknown[]]> = [];
function query(data: unknown, error: unknown = null) {
  const q: any = {};
  for (const method of ['select', 'eq', 'maybeSingle', 'order', 'limit']) q[method] = (...args: unknown[]) => { queryCalls.push([method, ...args]); return q; };
  q.then = (resolve: any) => Promise.resolve({ data, error }).then(resolve);
  return q;
}
beforeEach(async () => {
  jest.clearAllMocks(); mockId = 0; queryCalls.length = 0; await AsyncStorage.clear();
  mockUser.mockResolvedValue({ data: { user: { id: user } }, error: null });
  mockFrom.mockImplementation(() => query(null));
  mockRpc.mockResolvedValue({ data: null, error: new Error('Response lost') });
});
it('saves exact trimmed intent for review before any RPC and prevents replacement', async () => {
  const attempt = await preparePageUpdate(page, '  A gathering soon  ', scope);
  expect(attempt.body).toBe('A gathering soon'); expect(attempt.stage).toBe('prepared');
  expect(await readPendingPageUpdate(page, scope)).toEqual(attempt); expect(mockRpc).not.toHaveBeenCalled();
  await expect(preparePageUpdate(page, 'Another update', scope)).rejects.toThrow('saved update');
});
it.each(['', ' '.repeat(4), 'a'.repeat(2001)])('rejects invalid text before persistence or sending', async body => {
  await expect(preparePageUpdate(page, body, scope)).rejects.toThrow('1 to 2000');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled(); expect(mockRpc).not.toHaveBeenCalled();
});
it('does not dispatch without the exact durable original, including edited body', async () => {
  const attempt = await preparePageUpdate(page, 'Original', scope);
  await expect(sendPageUpdate({ ...attempt, body: 'Changed' }, scope)).rejects.toThrow('saved first');
  await AsyncStorage.removeItem(marker);
  await expect(sendPageUpdate(attempt, scope)).rejects.toThrow('saved first'); expect(mockRpc).not.toHaveBeenCalled();
});
it('does not dispatch if either preparation or the dispatch marker fails to persist', async () => {
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Disk full'));
  await expect(preparePageUpdate(page, 'Original', scope)).rejects.toThrow('Disk full');
  const attempt = await preparePageUpdate(page, 'Original', scope);
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Disk full'));
  await expect(sendPageUpdate(attempt, scope)).rejects.toThrow('Disk full'); expect(mockRpc).not.toHaveBeenCalled();
});
it('edits only before dispatch and preserves the original text', async () => {
  const attempt = await preparePageUpdate(page, 'Original', scope);
  expect(await editPreparedPageUpdate(attempt, scope)).toBe('Original');
  expect(await readPendingPageUpdate(page, scope)).toBeNull();
  const next = await preparePageUpdate(page, 'Changed', scope);
  await expect(sendPageUpdate(next, scope)).rejects.toThrow('Response lost');
  await expect(editPreparedPageUpdate(next, scope)).rejects.toThrow('before editing');
  expect((await readPendingPageUpdate(page, scope))?.stage).toBe('dispatched');
});
it('persists dispatch before RPC and retries only the original ID/body after an unknown result', async () => {
  const attempt = await preparePageUpdate(page, 'Original', scope);
  mockRpc.mockImplementationOnce(async () => {
    expect((await readPendingPageUpdate(page, scope))?.stage).toBe('dispatched'); throw new Error('Lost response');
  });
  await expect(sendPageUpdate(attempt, scope)).rejects.toThrow('Lost response');
  expect(mockRpc).toHaveBeenCalledTimes(1);
  mockRpc.mockResolvedValue({ data: receipt(attempt), error: null });
  expect(await sendPageUpdate(attempt, scope)).toEqual(receipt(attempt));
  expect(mockRpc.mock.calls[1]).toEqual(mockRpc.mock.calls[0]);
  expect(mockRpc).toHaveBeenCalledWith('send_creator_page_broadcast', { p_page_id: page, p_attempt_id: attempt.id, p_body: 'Original' });
});
it('reconciles a committed lost response using an exact read without sending again', async () => {
  const attempt = await preparePageUpdate(page, 'Original', scope);
  await expect(sendPageUpdate(attempt, scope)).rejects.toThrow();
  mockFrom.mockImplementation(() => query(row(attempt)));
  expect(await checkPageUpdate(attempt, scope)).toEqual(receipt(attempt));
  expect(queryCalls).toEqual(expect.arrayContaining([['eq', 'id', attempt.id], ['eq', 'creator_page_id', page], ['eq', 'sender_user_id', user]]));
  expect(await resolvePageUpdate(attempt, scope)).toEqual({ receipt: receipt(attempt), cleared: true });
  expect(await readPendingPageUpdate(page, scope)).toBeNull(); expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('never clears an absent or unreadable receipt as if the update had failed', async () => {
  const attempt = await preparePageUpdate(page, 'Original', scope);
  await expect(sendPageUpdate(attempt, scope)).rejects.toThrow();
  expect(await checkPageUpdate(attempt, scope)).toBeNull();
  await expect(resolvePageUpdate(attempt, scope)).rejects.toThrow('unconfirmed');
  mockFrom.mockImplementation(() => query(null, new Error('Offline')));
  await expect(checkPageUpdate(attempt, scope)).rejects.toThrow('Offline');
  expect((await readPendingPageUpdate(page, scope))?.id).toBe(attempt.id);
});
it.each(['id', 'page_id', 'sender_user_id', 'body', 'created_at', 'queued_recipient_count'])('rejects mismatched or malformed %s receipts without discarding recovery', async field => {
  const attempt = await preparePageUpdate(page, 'Original', scope);
  mockRpc.mockResolvedValue({ data: { ...receipt(attempt), [field]: field === 'queued_recipient_count' ? -1 : 'wrong' }, error: null });
  await expect(sendPageUpdate(attempt, scope)).rejects.toThrow('could not be confirmed');
  expect((await readPendingPageUpdate(page, scope))?.id).toBe(attempt.id);
});
it('serializes same-page sends and refuses concurrent editing', async () => {
  const attempt = await preparePageUpdate(page, 'Original', scope);
  let finish!: (value: unknown) => void;
  mockRpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const sending = sendPageUpdate(attempt, scope);
  await expect(sendPageUpdate(attempt, scope)).rejects.toThrow('still finishing');
  await expect(editPreparedPageUpdate(attempt, scope)).rejects.toThrow('still finishing');
  while (!finish) await Promise.resolve(); finish({ data: receipt(attempt), error: null });
  await sending; expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('checks the account again after saving the dispatch marker and retires late receipts', async () => {
  const attempt = await preparePageUpdate(page, 'Original', scope);
  mockUser.mockResolvedValueOnce({ data: { user: { id: user } }, error: null })
    .mockResolvedValueOnce({ data: { user: { id: 'other' } }, error: null });
  await expect(sendPageUpdate(attempt, scope)).rejects.toThrow(); expect(mockRpc).not.toHaveBeenCalled();
  let live = true;
  mockRpc.mockImplementation(async () => { live = false; return { data: receipt(attempt), error: null }; });
  await expect(sendPageUpdate(attempt, { ...scope, isCurrent: () => live })).rejects.toThrow();
  expect((await readPendingPageUpdate(page, scope))?.id).toBe(attempt.id);
});
it('preserves a confirmed result on cleanup failure and allows only confirmed replacement', async () => {
  const attempt = await preparePageUpdate(page, 'Original', scope);
  mockFrom.mockImplementation(() => query(row(attempt)));
  jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('Disk unavailable'));
  expect(await resolvePageUpdate(attempt, scope)).toEqual({ receipt: receipt(attempt), cleared: false });
  const next = await preparePageUpdate(page, 'Next', scope);
  expect(next.id).not.toBe(attempt.id); expect(mockRpc).not.toHaveBeenCalled();
});
it('fails closed on corrupt or wrong-account local recovery records', async () => {
  await AsyncStorage.setItem(marker, '{broken');
  await expect(readPendingPageUpdate(page, scope)).rejects.toThrow('could not be read');
  await AsyncStorage.removeItem(marker);
  const attempt = await preparePageUpdate(page, 'Original', scope);
  await AsyncStorage.setItem(marker, JSON.stringify({ ...attempt, userId: 'another' }));
  await expect(readPendingPageUpdate(page, scope)).rejects.toThrow('could not be read');
});
it('bounds history to the exact page/sender and rejects foreign rows instead of legacy fallback', async () => {
  const attempt = await preparePageUpdate(page, 'Original', scope);
  mockFrom.mockImplementation(() => query([row(attempt)]));
  expect(await readRecentPageUpdates(page, scope)).toEqual([receipt(attempt)]);
  expect(queryCalls).toEqual(expect.arrayContaining([['eq', 'creator_page_id', page], ['eq', 'sender_user_id', user], ['limit', 25]]));
  mockFrom.mockImplementation(() => query([{ ...row(attempt), creator_page_id: null }]));
  await expect(readRecentPageUpdates(page, scope)).rejects.toThrow('could not be confirmed');
});

it('bounds authorization before preparation without allocating an update',async()=>{
 jest.useFakeTimers();try{mockUser.mockReturnValueOnce(new Promise(()=>{}));const result=preparePageUpdate(page,'Original',scope);const failed=expect(result).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(12000);await failed;expect(mockId).toBe(0);expect(mockRpc).not.toHaveBeenCalled();}finally{jest.useRealTimers();}
});
it('a timed-out send keeps original identity and late receipt cannot erase recovery',async()=>{
 jest.useFakeTimers();try{const attempt=await preparePageUpdate(page,'Original',scope);let finish!:(value:any)=>void;mockRpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const result=sendPageUpdate(attempt,scope);const failed=expect(result).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(25000);await failed;expect((await readPendingPageUpdate(page,scope))?.id).toBe(attempt.id);mockFrom.mockImplementation(()=>query(row(attempt)));expect(await checkPageUpdate(attempt,scope)).toEqual(receipt(attempt));finish({data:receipt(attempt),error:null});await Promise.resolve();expect((await readPendingPageUpdate(page,scope))?.stage).toBe('dispatched');expect(mockRpc).toHaveBeenCalledTimes(1);}finally{jest.useRealTimers();}
});
it('bounds exact receipt reads without abandoning the saved attempt',async()=>{
 jest.useFakeTimers();try{const attempt=await preparePageUpdate(page,'Original',scope);const stuck:any={};for(const key of ['select','eq','maybeSingle'])stuck[key]=()=>stuck;stuck.then=()=>new Promise(()=>{});mockFrom.mockReturnValueOnce(stuck);const result=checkPageUpdate(attempt,scope);const failed=expect(result).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(12000);await failed;expect((await readPendingPageUpdate(page,scope))?.id).toBe(attempt.id);expect(mockRpc).not.toHaveBeenCalled();}finally{jest.useRealTimers();}
});
