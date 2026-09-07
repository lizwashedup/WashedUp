const mockRpc = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const { submitApplication } = require('../operatorApplications');

beforeEach(() => {
  mockRpc.mockReset();
});

describe('submitApplication', () => {
  it.each(['event_host', 'community_leader'])(
    'submits the %s track independently with the complete application payload',
    async (track) => {
      const application = {
        display_name: 'Sunset Society',
        proof_links: ['https://example.com/proof'],
        responsibilities_accepted: true,
      };
      mockRpc.mockResolvedValue({ data: `${track}-grant`, error: null });

      await expect(submitApplication(track, application)).resolves.toBe(`${track}-grant`);
      expect(mockRpc).toHaveBeenCalledWith('submit_operator_application', {
        p_track: track,
        p_application: application,
        p_accept_terms: true,
      });
    },
  );

  it('surfaces a server rejection instead of reporting a false success', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not eligible' } });

    await expect(submitApplication('event_host', { display_name: 'Nope' })).rejects.toEqual({
      message: 'not eligible',
    });
  });
});
