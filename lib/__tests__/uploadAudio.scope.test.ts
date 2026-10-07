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
