import { creationDestinations, loadCreationEntry } from '../creationEntry';
import { getCreatorAccess, type CreatorAccess, type LedCommunity } from '../creatorMode';
import { fetchMyGrants } from '../operatorApplications';

jest.mock('../creatorMode', () => ({
  getCreatorAccess: jest.fn(),
  isAdminTierRole: (role: string) => ['leader', 'co_leader', 'admin'].includes(role),
}));
jest.mock('../operatorApplications', () => ({ fetchMyGrants: jest.fn() }));
const empty: CreatorAccess = { ledCommunities: [], hasLeaderGrant: false, hasEventHostGrant: false, isRevoked: false };
const community = (id: string, role: LedCommunity['role'], status: LedCommunity['status'] = 'active'): LedCommunity => ({ id, role, status, name: id, handle: id });

it('does not grant tools to a new or revoked creator', () => {
  for (const isRevoked of [true, false]) for (const kind of ['event', 'community'] as const) {
    expect(creationDestinations(kind, { ...empty, isRevoked })).toEqual([]);
  }
});
it('checks event permission separately for every community', () => {
  const access = { ...empty, ledCommunities: [community('owner', 'leader'), community('events', 'events'), community('care', 'member_care'), community('finance', 'finance'), community('archived', 'leader', 'archived'), community('draft', 'leader', 'draft')] };
  expect(creationDestinations('event', access).map(item => item.id)).toEqual(['owner', 'events']);
});
it('sets a specific identity for organization and community events', () => {
  const choices = creationDestinations('event', { ...empty, hasEventHostGrant: true, ledCommunities: [community('club', 'admin')] });
  expect(choices).toEqual([
    expect.objectContaining({ workspace: 'organization', route: '/(creator)/events' }),
    expect.objectContaining({ workspace: 'community', communityId: 'club', route: '/(creator)/events' }),
  ]);
});
it('requires the actual creation grant for a new community while retaining allowed management', () => {
  const access = { ...empty, ledCommunities: [community('admin', 'admin'), community('care', 'member_care'), community('draft', 'leader', 'draft')] };
  expect(creationDestinations('community', access).map(item => item.id)).toEqual(['admin', 'draft']);
  expect(creationDestinations('community', { ...access, hasLeaderGrant: true })[0]).toMatchObject({ route: '/creator/setup-community' });
});
it('scopes both reads to the signed-in account', async () => {
  jest.mocked(getCreatorAccess).mockResolvedValue(empty);
  jest.mocked(fetchMyGrants).mockResolvedValue([]);
  await expect(loadCreationEntry({ userId: 'viewer', isCurrent: () => true })).resolves.toEqual({ access: empty, grants: [] });
  expect(getCreatorAccess).toHaveBeenCalledWith('viewer');
  expect(fetchMyGrants).toHaveBeenCalledWith('viewer');
});
it('rejects results after the visit or account changes', async () => {
  let current = true, resolve!: (value: CreatorAccess) => void;
  jest.mocked(getCreatorAccess).mockImplementation(() => new Promise(done => { resolve = done; }));
  const read = loadCreationEntry({ userId: 'viewer', isCurrent: () => current });
  current = false; resolve(empty);
  await expect(read).rejects.toThrow('Creation entry changed.');
});
it('treats an access failure as unknown rather than as an application requirement', async () => {
  jest.mocked(getCreatorAccess).mockRejectedValue(new Error('offline'));
  await expect(loadCreationEntry({ userId: 'viewer', isCurrent: () => true })).rejects.toThrow('offline');
});
