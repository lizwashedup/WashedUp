const mockResult = jest.fn();
jest.mock('../supabase', () => ({ supabase: { from: () => {
  const q: any = { select: () => q, eq: () => q, maybeSingle: () => mockResult() }; return q;
} } }));
import { getFollowState } from '../organizerFollows';
const target = { kind: 'organizer', id: 'organizer' } as const;
it('does not turn a failed read into confirmed not-following', async () => {
  const error = { message: 'Offline', code: '' }; mockResult.mockResolvedValue({ data: null, error });
  await expect(getFollowState(target, 'viewer')).rejects.toEqual(error);
});
it.each(['42P01', 'PGRST205', '42883', 'PGRST202'])('keeps missing schema %s dormant', async code => {
  mockResult.mockResolvedValue({ data: null, error: { code } });
  await expect(getFollowState(target, 'viewer')).resolves.toEqual({ available: false, following: false });
});
it.each([true, false])('returns a confirmed following state of %s', async following => {
  mockResult.mockResolvedValue({ data: following ? { id: 'follow' } : null, error: null });
  await expect(getFollowState(target, 'viewer')).resolves.toEqual({ available: true, following });
});
