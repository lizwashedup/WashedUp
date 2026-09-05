// Liz decision #14 (2026-09-03): community-scoped refund authority delegation.
// Mirrors the mock-supabase style used in configurableJoinQuestions.test.ts.

type QueryCall = { table: string; method: string; args: unknown[] };
const mockCalls: QueryCall[] = [];

const tableResults: Record<string, { data: unknown; error: unknown }> = {};
function resultFor(table: string) {
  return tableResults[table] ?? { data: [], error: null };
}

function makeChain(table: string) {
  const chain: any = {};
  for (const method of ['select', 'eq', 'in', 'order']) {
    chain[method] = (...args: unknown[]) => {
      mockCalls.push({ table, method, args });
      return chain;
    };
  }
  // makes `await supabase.from(x)...` resolve without a terminal call name,
  // same as the real supabase-js query builder being thenable.
  chain.then = (resolve: any, reject: any) => Promise.resolve(resultFor(table)).then(resolve, reject);
  return chain;
}

let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };

const mockSupabase = {
  from: jest.fn((table: string) => makeChain(table)),
  rpc: jest.fn((name: string, args: unknown) => {
    mockCalls.push({ table: 'rpc', method: name, args: [args] });
    return Promise.resolve(rpcResult);
  }),
};

jest.mock('../supabase', () => ({ supabase: mockSupabase }));

const {
  grantCommunityRefundAuthority,
  revokeRefundAuthority,
  listCommunityRefundAuthorityGrants,
  activeGrantForUser,
  listCommunityRefundIssuanceLog,
  formatRefundAmount,
  refundKindLabel,
} = require('../refundAuthority');

beforeEach(() => {
  mockCalls.length = 0;
  for (const key of Object.keys(tableResults)) delete tableResults[key];
  rpcResult = { data: null, error: null };
  mockSupabase.from.mockClear();
  mockSupabase.rpc.mockClear();
});

describe('grantCommunityRefundAuthority', () => {
  it('always sends p_acknowledged: true -- the UI confirm dialog IS the acknowledgment', async () => {
    rpcResult = { data: 'grant-1', error: null };
    const id = await grantCommunityRefundAuthority('community-1', 'user-2');
    expect(id).toBe('grant-1');
    const call = mockCalls.find((c) => c.table === 'rpc' && c.method === 'grant_refund_authority');
    expect(call?.args[0]).toEqual({
      p_grantee_user_id: 'user-2',
      p_community_id: 'community-1',
      p_acknowledged: true,
    });
  });

  it('never sends an event id -- this is the community/creator-account scope only', async () => {
    rpcResult = { data: 'grant-1', error: null };
    await grantCommunityRefundAuthority('community-1', 'user-2');
    const call = mockCalls.find((c) => c.table === 'rpc' && c.method === 'grant_refund_authority');
    expect(call?.args[0]).not.toHaveProperty('p_event_id');
  });

  it('propagates the server error (e.g. grantee is not yet an active co-creator)', async () => {
    rpcResult = {
      data: null,
      error: { message: 'grant refund authority to an existing co-creator of this community first' },
    };
    await expect(grantCommunityRefundAuthority('community-1', 'user-2')).rejects.toBeTruthy();
  });
});

describe('revokeRefundAuthority', () => {
  it('sends the grant id', async () => {
    await revokeRefundAuthority('grant-1');
    const call = mockCalls.find((c) => c.table === 'rpc' && c.method === 'revoke_refund_authority');
    expect(call?.args[0]).toEqual({ p_grant_id: 'grant-1' });
  });

  it('propagates a not-authorized error rather than swallowing it', async () => {
    rpcResult = { data: null, error: { message: 'not authorized to revoke this grant' } };
    await expect(revokeRefundAuthority('grant-1')).rejects.toBeTruthy();
  });
});

describe('listCommunityRefundAuthorityGrants', () => {
  it('maps snake_case rows to the client shape, filtered to creator_account + active', async () => {
    tableResults.refund_authority_grants = {
      data: [
        {
          id: 'g1',
          scope: 'creator_account',
          event_id: null,
          community_id: 'c1',
          grantee_user_id: 'u2',
          granted_by_user_id: 'u1',
          active: true,
          granted_at: '2026-09-04T00:00:00.000Z',
          revoked_at: null,
          revoked_by_user_id: null,
        },
      ],
      error: null,
    };
    const grants = await listCommunityRefundAuthorityGrants('c1');
    expect(grants).toEqual([
      {
        id: 'g1',
        scope: 'creator_account',
        eventId: null,
        communityId: 'c1',
        granteeUserId: 'u2',
        grantedByUserId: 'u1',
        active: true,
        grantedAt: '2026-09-04T00:00:00.000Z',
        revokedAt: null,
        revokedByUserId: null,
      },
    ]);
    const eqCalls = mockCalls.filter((c) => c.table === 'refund_authority_grants' && c.method === 'eq');
    expect(eqCalls.map((c) => c.args)).toEqual([
      ['community_id', 'c1'],
      ['scope', 'creator_account'],
      ['active', true],
    ]);
  });

  it('throws on a query error rather than returning an empty list', async () => {
    tableResults.refund_authority_grants = { data: null, error: { message: 'boom' } };
    await expect(listCommunityRefundAuthorityGrants('c1')).rejects.toBeTruthy();
  });
});

describe('activeGrantForUser', () => {
  const grant = (overrides: Record<string, unknown> = {}) => ({
    id: 'g1',
    scope: 'creator_account',
    eventId: null,
    communityId: 'c1',
    granteeUserId: 'u2',
    grantedByUserId: 'u1',
    active: true,
    grantedAt: '2026-09-04T00:00:00.000Z',
    revokedAt: null,
    revokedByUserId: null,
    ...overrides,
  });

  it('finds the active grant belonging to the given user', () => {
    expect(activeGrantForUser([grant()], 'u2')).toEqual(grant());
  });

  it('ignores a revoked (inactive) grant for that same user', () => {
    expect(activeGrantForUser([grant({ active: false })], 'u2')).toBeNull();
  });

  it('returns null when no grant matches the user', () => {
    expect(activeGrantForUser([grant()], 'someone-else')).toBeNull();
  });
});

describe('listCommunityRefundIssuanceLog', () => {
  it('short-circuits to [] when the community has no events, without querying the log at all', async () => {
    tableResults.explore_events = { data: [], error: null };
    const rows = await listCommunityRefundIssuanceLog('c1');
    expect(rows).toEqual([]);
    expect(mockCalls.some((c) => c.table === 'refund_issuance_log')).toBe(false);
  });

  it('joins event title and issuer display name onto each log row', async () => {
    tableResults.explore_events = { data: [{ id: 'e1', title: 'Rooftop mixer' }], error: null };
    tableResults.refund_issuance_log = {
      data: [
        {
          id: 'log1',
          order_id: 'o1',
          issued_by_user_id: 'u2',
          issuer_is_owner: false,
          reason: 'buyer asked twice',
          kind: 'buyer_request',
          position_indexes: [1],
          refund_amount_cents: 2500,
          stripe_refund_id: 're_1',
          created_at: '2026-09-04T00:00:00.000Z',
          ticket_orders: { event_id: 'e1' },
        },
      ],
      error: null,
    };
    tableResults.profiles_public = { data: [{ id: 'u2', first_name_display: 'Sage' }], error: null };

    const rows = await listCommunityRefundIssuanceLog('c1');
    expect(rows).toEqual([
      {
        id: 'log1',
        orderId: 'o1',
        eventId: 'e1',
        eventTitle: 'Rooftop mixer',
        issuedByUserId: 'u2',
        issuedByName: 'Sage',
        issuerIsOwner: false,
        reason: 'buyer asked twice',
        kind: 'buyer_request',
        positionIndexes: [1],
        refundAmountCents: 2500,
        stripeRefundId: 're_1',
        createdAt: '2026-09-04T00:00:00.000Z',
      },
    ]);
    const inCall = mockCalls.find((c) => c.table === 'refund_issuance_log' && c.method === 'in');
    expect(inCall?.args).toEqual(['ticket_orders.event_id', ['e1']]);
  });

  it('falls back to a null issuer name when no profile row is found', async () => {
    tableResults.explore_events = { data: [{ id: 'e1', title: 'Rooftop mixer' }], error: null };
    tableResults.refund_issuance_log = {
      data: [
        {
          id: 'log1',
          order_id: 'o1',
          issued_by_user_id: 'u2',
          issuer_is_owner: true,
          reason: null,
          kind: 'organizer_cancel',
          position_indexes: null,
          refund_amount_cents: 1000,
          stripe_refund_id: 're_2',
          created_at: '2026-09-04T00:00:00.000Z',
          ticket_orders: { event_id: 'e1' },
        },
      ],
      error: null,
    };
    tableResults.profiles_public = { data: [], error: null };

    const rows = await listCommunityRefundIssuanceLog('c1');
    expect(rows[0].issuedByName).toBeNull();
  });

  it('throws when the events query errors', async () => {
    tableResults.explore_events = { data: null, error: { message: 'boom' } };
    await expect(listCommunityRefundIssuanceLog('c1')).rejects.toBeTruthy();
  });

  it('throws when the log query errors', async () => {
    tableResults.explore_events = { data: [{ id: 'e1', title: 'x' }], error: null };
    tableResults.refund_issuance_log = { data: null, error: { message: 'boom' } };
    await expect(listCommunityRefundIssuanceLog('c1')).rejects.toBeTruthy();
  });
});

describe('formatRefundAmount', () => {
  it.each([
    [2500, '$25.00'],
    [999, '$9.99'],
    [100, '$1.00'],
    [50, '$0.50'],
  ])('formats %i cents as %s', (cents, expected) => {
    expect(formatRefundAmount(cents)).toBe(expected);
  });
});

describe('refundKindLabel', () => {
  it.each([
    ['buyer_request', 'Refund'],
    ['organizer_cancel', 'Event canceled'],
    ['admin', 'Support refund'],
  ])('labels %s as a plain, non-jargon string', (kind, expected) => {
    expect(refundKindLabel(kind)).toBe(expected);
  });
});
