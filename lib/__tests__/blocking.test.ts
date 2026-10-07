import { getBlockedWith } from '../blocking';
const mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: any[]) => mockRpc(...args) } }));
beforeEach(() => mockRpc.mockReset());
it('checks each other person once and accepts only an explicit false', async () => {
  mockRpc.mockImplementation(async (_name, args) => ({ data: args.p_b === 'allowed' ? false : true, error: null }));
  expect(await getBlockedWith('viewer', ['viewer', null, undefined, 'blocked', 'allowed', 'blocked'])).toEqual(new Set(['blocked']));
  expect(mockRpc).toHaveBeenCalledTimes(2);
});
it.each([null, undefined, [], {}, 'false', 0, true])('hides unknown or blocked status %j', async data => {
  mockRpc.mockResolvedValue({ data, error: null }); expect(await getBlockedWith('viewer', ['peer'])).toEqual(new Set(['peer']));
});
it('fails closed for both returned and thrown failures without losing other results', async () => {
  mockRpc.mockResolvedValueOnce({ data: false, error: new Error('denied') })
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: false, error: null });
  expect(await getBlockedWith('viewer', ['returned', 'thrown', 'allowed'])).toEqual(new Set(['returned', 'thrown']));
});
it('makes no calls without a viewer or candidates', async () => {
  expect(await getBlockedWith(null, ['peer'])).toEqual(new Set());
  expect(await getBlockedWith('viewer', [])).toEqual(new Set()); expect(mockRpc).not.toHaveBeenCalled();
});
