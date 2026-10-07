import { readOwnProfile, saveOwnProfile, normalizeProfileHandle } from '../profileOperations';
import { profileSaveFeedback } from '../profileSaveFeedback';

const mockUser = jest.fn(), mockRefresh = jest.fn(), mockSingle = jest.fn(), mockUpdateResult = jest.fn(), mockUpload = jest.fn();
const mockSelect = jest.fn(), mockUpdate = jest.fn(), mockEq = jest.fn();
jest.mock('../../../../../lib/supabase', () => ({ supabase: {
  auth: { getUser: (...args: unknown[]) => mockUser(...args), refreshSession: (...args: unknown[]) => mockRefresh(...args) },
  from: (table: string) => ({
    select: (fields: string) => { mockSelect(table, fields); return { eq: (key: string, id: string) => { mockEq(key, id); return { single: mockSingle }; } }; },
    update: (fields: unknown, options: unknown) => { mockUpdate(table, fields, options); return { eq: (key: string, id: string) => { mockEq(key, id); return mockUpdateResult(); } }; },
  }),
} }));
jest.mock('../../../../../lib/uploadPhoto', () => ({ uploadBase64ToStorage: (...args: unknown[]) => mockUpload(...args) }));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const original = { name: ' Liz ', handle: 'LiZ_1', neighborhood: ' Pasadena ', isVisitor: false, funFact: ' Volleyball ', photoUrl: 'old.jpg', photoBase64: null as string | null };
let current: boolean;
const scope = { userId: 'account-a', isCurrent: () => current };
beforeEach(() => {
  jest.clearAllMocks(); current = true;
  mockUser.mockReset().mockResolvedValue({ data: { user: { id: 'account-a' } }, error: null });
  mockRefresh.mockReset().mockResolvedValue({ data: { session: { user: { id: 'account-a' } } }, error: null });
  mockSingle.mockReset().mockResolvedValue({ data: { id: 'account-a', first_name_display: 'Liz', gender: 'female' }, error: null });
  mockUpdateResult.mockReset().mockResolvedValue({ error: null, count: 1 });
  mockUpload.mockReset().mockResolvedValue('saved.jpg');
});

it('reads only the original own-profile fields and captured account', async () => {
  expect(await readOwnProfile(scope)).toMatchObject({ id: 'account-a', first_name: 'Liz', gender: 'female', avatar_url: null, is_visitor: false });
  expect(mockSelect).toHaveBeenCalledWith('profiles', 'id, first_name_display, profile_photo_url, bio, city, gender, handle, neighborhood, is_visitor, fun_fact');
  expect(mockEq).toHaveBeenCalledWith('id', 'account-a');
});
it('keeps missing, failed and mismatched profile reads distinct', async () => {
  mockSingle.mockResolvedValueOnce({ data: null, error: null }); expect(await readOwnProfile(scope)).toBeNull();
  mockSingle.mockResolvedValueOnce({ data: null, error: new Error('offline') }); await expect(readOwnProfile(scope)).rejects.toThrow('offline');
  mockSingle.mockResolvedValueOnce({ data: { id: 'account-b' }, error: null }); await expect(readOwnProfile(scope)).rejects.toThrow('confirm this profile');
});
it('does not query after an account preflight changes or the visit closes', async () => {
  mockUser.mockResolvedValueOnce({ data: { user: { id: 'account-b' } } });
  await expect(readOwnProfile(scope)).rejects.toThrow('no longer current');
  expect(mockSelect).not.toHaveBeenCalled();
});
it('retires a delayed authenticated read before querying or returning data', async () => {
  const auth = deferred<any>(); mockUser.mockReturnValueOnce(auth.promise);
  const pending = readOwnProfile(scope); current = false; auth.resolve({ data: { user: { id: 'account-a' } } });
  await expect(pending).rejects.toThrow('no longer current'); expect(mockSelect).not.toHaveBeenCalled();
  current = true; const read = deferred<any>(); mockSingle.mockReturnValueOnce(read.promise);
  const late = readOwnProfile(scope); await Promise.resolve(); await Promise.resolve(); current = false;
  read.resolve({ data: { id: 'account-a' } }); await expect(late).rejects.toThrow('no longer current');
});
it('saves a snapshot of exactly the six existing editable fields with a confirmed one-row receipt', async () => {
  const auth = deferred<any>(); mockUser.mockReturnValueOnce(auth.promise);
  const edit = { ...original }; const saving = saveOwnProfile(edit, scope); edit.name = 'Later draft';
  auth.resolve({ data: { user: { id: 'account-a' } } });
  const expected = { first_name_display: 'Liz', profile_photo_url: 'old.jpg', handle: 'liz_1', neighborhood: 'Pasadena', is_visitor: false, fun_fact: 'Volleyball' };
  expect(await saving).toEqual(expected); expect(mockUpdate).toHaveBeenCalledWith('profiles', expected, { count: 'exact' });
  expect(mockEq).toHaveBeenCalledWith('id', 'account-a'); expect(mockRefresh).not.toHaveBeenCalled();
});
it.each([0, null, undefined, 2])('does not confirm a missing/invalid update count (%s)', async count => {
  mockUpdateResult.mockResolvedValue({ error: null, count });
  await expect(saveOwnProfile(original, scope)).rejects.toThrow('confirm your changes');
});
it('preserves the original server rejection instead of confirming a save', async () => {
  mockUpdateResult.mockResolvedValue({ error: new Error('Handle already used'), count: null });
  await expect(saveOwnProfile(original, scope)).rejects.toThrow('Handle already used');
  expect(profileSaveFeedback(new Error('Handle already used'))).toBe('This handle is taken. Choose another one.');
  expect(profileSaveFeedback({ code: '23505', message: 'duplicate key value violates unique constraint "profiles_handle_key"' })).toBe('This handle is taken. Choose another one.');
  expect(profileSaveFeedback(new Error('Please enter a display name.'))).toBe('Please enter a display name.');
  for (const error of [new Error('Simulated profile save failure'), new Error('Failed to fetch'), { code: '23505', message: 'duplicate key value violates unique constraint "other_key"' }]) {
    expect(profileSaveFeedback(error)).toBe('Your changes are still here. Try saving again.');
  }
});
it('requires the original refreshed photo owner before uploading', async () => {
  mockRefresh.mockResolvedValue({ data: { session: { user: { id: 'account-b' } } }, error: null });
  await expect(saveOwnProfile({ ...original, photoBase64: 'jpeg' }, scope)).rejects.toThrow('no longer current');
  expect(mockUpload).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled();
});
it('retains the JPEG bucket/path and upload options before saving the returned photo', async () => {
  const result = await saveOwnProfile({ ...original, photoBase64: 'jpeg' }, scope);
  expect(mockUpload).toHaveBeenCalledWith('profile-photos', expect.stringMatching(/^account-a\/\d+\.jpg$/), 'jpeg', { upsert: true });
  expect(result.profile_photo_url).toBe('saved.jpg');
});
it('does not update the profile after a completed upload from a closed visit', async () => {
  const upload = deferred<string>(); mockUpload.mockReturnValue(upload.promise);
  const saving = saveOwnProfile({ ...original, photoBase64: 'jpeg' }, scope);
  for (let index = 0; index < 8; index++) await Promise.resolve();
  expect(mockUpload).toHaveBeenCalledTimes(1); current = false; upload.resolve('late.jpg');
  await expect(saving).rejects.toThrow('no longer current'); expect(mockUpdate).not.toHaveBeenCalled();
});
it('retires an accepted update response after leaving without claiming it was undone', async () => {
  const update = deferred<any>(); mockUpdateResult.mockReturnValue(update.promise);
  const saving = saveOwnProfile(original, scope); for (let index = 0; index < 8; index++) await Promise.resolve();
  expect(mockUpdate).toHaveBeenCalledTimes(1); current = false; update.resolve({ error: null, count: 1 });
  await expect(saving).rejects.toThrow('no longer current');
});
it('keeps the existing handle normalization, including underscores and the length limit', () => {
  expect(normalizeProfileHandle('@A_B.!-12345678901234567890')).toBe('a_b12345678901234567');
});
