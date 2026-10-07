const mockStorage = new Map<string, string>(), mockGet = jest.fn(), mockSet = jest.fn();
let mockAccount = '', mockFailRead = false, mockLoseReply = false;
const mockRows = new Map<string, any>(), mockCalls: any[] = [];
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: (...a: unknown[]) => mockGet(...a), setItem: (...a: unknown[]) => mockSet(...a) } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
jest.mock('../supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: mockAccount }, access_token: mockAccount + '-token' } }, error: null }) },
  from: () => { let id: string, header: string; const q: any = { select: () => q, eq: (key: string, value: string) => { if (key === 'id') id = value; return q; }, maybeSingle: () => q, abortSignal: () => q, setHeader: (_key: string, value: string) => { header = value; return q; }, then: (resolve: any) => { mockCalls.push({ kind: 'read', header }); return Promise.resolve({ data: mockRows.get(id) ?? null, error: mockFailRead ? Error('Offline') : null }).then(resolve); } }; return q; },
  rpc: (_name: string, args: any) => { let header: string; const q: any = { abortSignal: () => q, setHeader: (_key: string, value: string) => { header = value; return q; }, then: (resolve: any, reject: any) => Promise.resolve().then(() => { mockCalls.push({ kind: 'write', args, header }); const row = { id: args.p_message_id, created_at: '2026-09-18T12:00:00Z', body: args.p_message.trim(), sender_id: mockAccount, topic_id: mockTopic }; mockRows.set(row.id, row); if (mockLoseReply) { mockLoseReply = false; throw Error('No acknowledgement'); } return { data: { id: row.id, created_at: row.created_at }, error: null }; }).then(resolve, reject) }; return q; },
} }));
import { readTopicWelcome, saveTopicWelcomeDraft, prepareTopicWelcome, sendTopicWelcome, checkTopicWelcome, finishTopicWelcome } from '../topicWelcome';
const user = '10000000-0000-4000-8000-000000000001', event = '20000000-0000-4000-8000-000000000001';
let live = true, mockTopic: string, counter = 0;
const owner = { userId: user, isCurrent: () => live };
beforeEach(() => { mockTopic = `30000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`; live = true; mockAccount = user; mockFailRead = false; mockLoseReply = false; mockRows.clear(); mockCalls.length = 0; mockStorage.clear(); mockGet.mockReset().mockImplementation(async k => mockStorage.get(k) ?? null); mockSet.mockReset().mockImplementation(async (k, v) => { mockStorage.set(k, v); }); });
async function prepare(text = 'Hello everyone') { await saveTopicWelcomeDraft(mockTopic, event, owner, text); return prepareTopicWelcome(mockTopic, event, owner, text); }
it('preserves latest queued typing and original pending identity separately', async () => {
  await Promise.all([saveTopicWelcomeDraft(mockTopic, event, owner, 'First'), saveTopicWelcomeDraft(mockTopic, event, owner, 'Second')]);
  const attempt = await prepareTopicWelcome(mockTopic, event, owner, 'Second'); await saveTopicWelcomeDraft(mockTopic, event, owner, 'Newer text');
  expect(await readTopicWelcome(mockTopic, event, owner)).toEqual({ text: 'Newer text', attempt });
});
it('serializes competing preparations before dispatch', async () => {
  const results = await Promise.allSettled([prepareTopicWelcome(mockTopic, event, owner, 'First'), prepareTopicWelcome(mockTopic, event, owner, 'Second')]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect((await readTopicWelcome(mockTopic, event, owner)).attempt?.text).toBe('First'); expect(mockCalls).toHaveLength(0);
});
it('finishes already initiated local typing on navigation under its original key', async () => {
  const saving = saveTopicWelcomeDraft(mockTopic, event, owner, 'Before back'); live = false; await saving; live = true;
  expect((await readTopicWelcome(mockTopic, event, owner)).text).toBe('Before back');
});
it('returns no draft or attempt to a different account', async () => {
  await prepare(); expect(await readTopicWelcome(mockTopic, event, { ...owner, userId: event })).toEqual({ text: '', attempt: null });
});
it('keeps a failed storage write in memory but never dispatches it', async () => {
  mockSet.mockRejectedValueOnce(Error('Disk unavailable')); await expect(prepareTopicWelcome(mockTopic, event, owner, 'Original')).rejects.toThrow();
  const state = await readTopicWelcome(mockTopic, event, owner); expect(state.unsaved).toBe(true); expect(state.attempt?.text).toBe('Original'); expect(mockCalls).toHaveLength(0);
  await sendTopicWelcome(state.attempt!, owner); expect(mockCalls.filter(c => c.kind === 'write')).toHaveLength(1);
});
it('recovers a lost successful acknowledgement with the original ID and no resend on return', async () => {
  const attempt = await prepare('  Welcome  '); mockLoseReply = true; expect((await sendTopicWelcome(attempt, owner)).id).toBe(attempt.id);
  await sendTopicWelcome((await readTopicWelcome(mockTopic, event, owner)).attempt!, owner);
  expect(mockCalls.filter(c => c.kind === 'write')).toHaveLength(1); expect(mockCalls.every(c => c.header === 'Bearer ' + user + '-token')).toBe(true);
});
it('read-only confirmation never posts and preserves newer typing on finish', async () => {
  const attempt = await prepare(); await sendTopicWelcome(attempt, owner); await saveTopicWelcomeDraft(mockTopic, event, owner, 'Newer'); const count = mockCalls.length;
  await checkTopicWelcome(attempt, owner); expect(mockCalls.slice(count).every(c => c.kind === 'read')).toBe(true);
  expect(await finishTopicWelcome(attempt, owner)).toEqual({ text: 'Newer', attempt: null });
});
it('retains the original receipt recovery if local finish fails', async () => {
  const attempt = await prepare(); await sendTopicWelcome(attempt, owner); mockSet.mockRejectedValueOnce(Error('Disk unavailable'));
  await expect(finishTopicWelcome(attempt, owner)).rejects.toThrow(); expect((await readTopicWelcome(mockTopic, event, owner)).attempt).toEqual(attempt);
  await finishTopicWelcome(attempt, owner); expect((await readTopicWelcome(mockTopic, event, owner)).attempt).toBeNull();
});
it('preserves unreadable originals and refuses wrong-account or retired requests', async () => {
  const attempt = await prepare(); mockAccount = event; await expect(sendTopicWelcome(attempt, owner)).rejects.toThrow(); expect(mockCalls).toHaveLength(0);
  mockAccount = user; live = false; await expect(checkTopicWelcome(attempt, owner)).rejects.toThrow(); expect(mockCalls).toHaveLength(0);
  live = true; mockStorage.set(`topic-welcome:v1:${user}:${mockTopic}`, '{broken'); await expect(readTopicWelcome(mockTopic, event, owner)).rejects.toThrow(); expect(mockStorage.get(`topic-welcome:v1:${user}:${mockTopic}`)).toBe('{broken');
});
it('does not accept mismatched body or sender receipts', async () => {
  const attempt = await prepare(); await sendTopicWelcome(attempt, owner); mockRows.get(attempt.id).body = 'Changed'; await expect(checkTopicWelcome(attempt, owner)).rejects.toThrow('did not match');
  mockRows.get(attempt.id).body = attempt.text; mockRows.get(attempt.id).sender_id = event; await expect(checkTopicWelcome(attempt, owner)).rejects.toThrow('did not match');
});
