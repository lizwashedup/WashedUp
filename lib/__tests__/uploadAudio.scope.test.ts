import { uploadAudioToStorage } from '../uploadAudio';
const mockRead = jest.fn(), mockUpload = jest.fn(), mockPublicUrl = jest.fn();
const mockFrom = jest.fn((..._args: unknown[]) => ({ upload: mockUpload, getPublicUrl: mockPublicUrl }));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: (...args: unknown[]) => mockRead(...args), EncodingType: { Base64: 'base64' } }));
jest.mock('../supabase', () => ({ supabase: { storage: { from: (...args: unknown[]) => mockFrom(...args) } } }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  jest.clearAllMocks(); mockRead.mockResolvedValue('AA=='); mockUpload.mockResolvedValue({ error: null });
  mockPublicUrl.mockReturnValue({ data: { publicUrl: 'https://example.invalid/clip.m4a' } });
  jest.spyOn(Date, 'now').mockReturnValue(42);
});
afterEach(() => jest.restoreAllMocks());
it('preserves the existing audio bucket, m4a path, content type and URL', async () => {
  await expect(uploadAudioToStorage('circle-one', 'person-one', 'file:///clip.m4a')).resolves.toBe('https://example.invalid/clip.m4a');
  expect(mockRead).toHaveBeenCalledWith('file:///clip.m4a', { encoding: 'base64' });
  expect(mockFrom).toHaveBeenCalledWith('chat-audio');
  expect(mockUpload).toHaveBeenCalledWith('circle-one/person-one/42.m4a', expect.any(ArrayBuffer), { contentType: 'audio/mp4', upsert: false });
});
it('does not read the local file for a retired caller', async () => {
  await expect(uploadAudioToStorage('room', 'person', 'file:///old.m4a', { isCurrent: () => false })).rejects.toThrow('Conversation changed');
  expect(mockRead).not.toHaveBeenCalled(); expect(mockUpload).not.toHaveBeenCalled();
});
it('does not upload a file after its read loses the entry', async () => {
  let current = true; const pending = deferred<string>(); mockRead.mockReturnValueOnce(pending.promise);
  const work = uploadAudioToStorage('room', 'person', 'file:///old.m4a', { isCurrent: () => current });
  const rejected = expect(work).rejects.toThrow('Conversation changed');
  current = false; pending.resolve('AA=='); await rejected;
  expect(mockUpload).not.toHaveBeenCalled();
});
it('does not expose an uploaded URL to a retired entry', async () => {
  let current = true; const pending = deferred<{ error: null }>(); mockUpload.mockReturnValueOnce(pending.promise);
  const work = uploadAudioToStorage('room', 'person', 'file:///old.m4a', { isCurrent: () => current });
  const rejected = expect(work).rejects.toThrow('Conversation changed');
  await Promise.resolve(); current = false; pending.resolve({ error: null }); await rejected;
  expect(mockUpload).toHaveBeenCalledTimes(1); expect(mockPublicUrl).not.toHaveBeenCalled();
});
it('retains current file/storage errors without making a success URL', async () => {
  mockUpload.mockResolvedValueOnce({ error: new Error('upload failed') });
  await expect(uploadAudioToStorage('room', 'person', 'file:///clip.m4a', { isCurrent: () => true })).rejects.toThrow('upload failed');
  expect(mockPublicUrl).not.toHaveBeenCalled();
});

const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
it('recovers a lost upload response at the same immutable key without creating another recording', async () => {
  const objects = new Map<string, ArrayBuffer>();
  mockUpload.mockImplementation(async (path: string, bytes: ArrayBuffer) => {
    if (objects.has(path)) return { error: { status: 400, statusCode: '409', message: 'The resource already exists' } };
    objects.set(path, bytes);
    throw Error('Response lost after storage commit');
  });
  await expect(uploadAudioToStorage('room', 'person', 'file:///clip.m4a', undefined, uploadId)).rejects.toThrow('Response lost');
  jest.mocked(Date.now).mockReturnValue(999);
  await expect(uploadAudioToStorage('room', 'person', 'file:///clip.m4a', undefined, uploadId)).resolves.toContain('clip.m4a');
  expect(objects.size).toBe(1);
  expect(mockUpload.mock.calls.map(call => call[0])).toEqual([`room/person/${uploadId}.m4a`, `room/person/${uploadId}.m4a`]);
  expect(mockUpload.mock.calls.every(call => call[2].upsert === false)).toBe(true);
});
it('keeps different recording intents distinct even when the clock and local URI are identical', async () => {
  await uploadAudioToStorage('room', 'person', 'file:///clip.m4a', undefined, uploadId);
  await uploadAudioToStorage('room', 'person', 'file:///clip.m4a', undefined, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  expect(mockUpload.mock.calls[0][0]).not.toBe(mockUpload.mock.calls[1][0]);
});
it('does not treat a legacy timestamp collision as a retry receipt', async () => {
  mockUpload.mockResolvedValueOnce({ error: { status: 409, message: 'The resource already exists' } });
  await expect(uploadAudioToStorage('room', 'person', 'file:///clip.m4a')).rejects.toMatchObject({status:409});
  expect(mockPublicUrl).not.toHaveBeenCalled();
});
it('rejects an invalid stable upload identity before reading or uploading bytes', async () => {
  await expect(uploadAudioToStorage('room', 'person', 'file:///clip.m4a', undefined, '../another')).rejects.toThrow('Invalid recording');
  expect(mockRead).not.toHaveBeenCalled(); expect(mockUpload).not.toHaveBeenCalled();
});
it('does not turn a duplicate receipt from a retired visit into a playable URL', async () => {
  let current = true;
  mockUpload.mockImplementationOnce(async () => { current = false; return {error:{status:409,message:'The resource already exists'}}; });
  await expect(uploadAudioToStorage('room', 'person', 'file:///clip.m4a', {isCurrent:()=>current}, uploadId)).rejects.toThrow('Conversation changed');
  expect(mockPublicUrl).not.toHaveBeenCalled();
});
