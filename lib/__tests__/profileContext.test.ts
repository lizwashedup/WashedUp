import { availableProfileContexts, resolveProfileContext } from '../profileContext';

describe('profile context access foundation', () => {
  it('always gives a person context and exposes only active leadership contexts', () => {
    expect(availableProfileContexts({
      userId: 'user-1',
      hasCreatorGrant: false,
      memberships: [
        { communityId: 'community-b', role: 'co_leader', active: true },
        { communityId: 'community-a', role: 'leader', active: true },
        { communityId: 'community-member', role: 'member', active: true },
        { communityId: 'community-old', role: 'leader', active: false },
        { communityId: 'community-a', role: 'leader', active: true },
      ],
    })).toEqual([
      { key: 'person:user-1', kind: 'person', ownerUserId: 'user-1', communityId: null },
      { key: 'creator:user-1', kind: 'creator', ownerUserId: 'user-1', communityId: null },
      { key: 'community:community-a', kind: 'community', ownerUserId: 'user-1', communityId: 'community-a' },
      { key: 'community:community-b', kind: 'community', ownerUserId: 'user-1', communityId: 'community-b' },
    ]);
  });

  it('fails closed to the person context when a requested context is unavailable', () => {
    const contexts = availableProfileContexts({
      userId: 'user-1',
      hasCreatorGrant: true,
      memberships: [],
    });
    expect(resolveProfileContext('community:not-mine', contexts)?.key).toBe('person:user-1');
    expect(resolveProfileContext('creator:user-1', contexts)?.key).toBe('creator:user-1');
    expect(resolveProfileContext(null, [])).toBeNull();
  });
});
