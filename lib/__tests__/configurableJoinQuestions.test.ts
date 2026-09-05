// Liz decision #11 (2026-09-03): the creatorMode.ts data-layer additions for
// the leader-side config (getJoinQuestionsConfig/updateJoinQuestionsConfig),
// the rules-confirm eligibility gate (getCommunityRestrictedGender), and the
// reviewer projection extension (getJoinAnswerCards).

type QueryCall = { table: string; method: string; args: unknown[] };

const mockCalls: QueryCall[] = [];
let communitiesSelectResult: { data: unknown; error: unknown } = { data: null, error: null };
let communityMemberAnswersResult: { data: unknown; error: unknown } = { data: null, error: null };
let updateResult: { error: unknown; count: number | null } = { error: null, count: 1 };
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };

function communitiesChain() {
  const chain: any = {
    select: (...args: unknown[]) => {
      mockCalls.push({ table: 'communities', method: 'select', args });
      return chain;
    },
    eq: (...args: unknown[]) => {
      mockCalls.push({ table: 'communities', method: 'eq', args });
      return chain;
    },
    maybeSingle: () => Promise.resolve(communitiesSelectResult),
    update: (...args: unknown[]) => {
      mockCalls.push({ table: 'communities', method: 'update', args });
      return updateChain;
    },
  };
  const updateChain: any = {
    eq: (...args: unknown[]) => {
      mockCalls.push({ table: 'communities', method: 'update.eq', args });
      return Promise.resolve(updateResult);
    },
  };
  return chain;
}

function communityMemberAnswersChain() {
  const chain: any = {
    select: (...args: unknown[]) => {
      mockCalls.push({ table: 'community_member_answers', method: 'select', args });
      return chain;
    },
    eq: (...args: unknown[]) => {
      mockCalls.push({ table: 'community_member_answers', method: 'eq', args });
      return Promise.resolve(communityMemberAnswersResult);
    },
  };
  return chain;
}

const mockSupabase = {
  from: jest.fn((table: string) => {
    if (table === 'communities') return communitiesChain();
    if (table === 'community_member_answers') return communityMemberAnswersChain();
    throw new Error(`unexpected table in test: ${table}`);
  }),
  rpc: jest.fn((name: string, args: unknown) => {
    mockCalls.push({ table: 'rpc', method: name, args: [args] });
    return Promise.resolve(rpcResult);
  }),
};

jest.mock('../supabase', () => ({ supabase: mockSupabase }));

const {
  getJoinQuestionsConfig,
  updateJoinQuestionsConfig,
  getCommunityRestrictedGender,
  getJoinAnswerCards,
} = require('../creatorMode');

beforeEach(() => {
  mockCalls.length = 0;
  communitiesSelectResult = { data: null, error: null };
  communityMemberAnswersResult = { data: null, error: null };
  updateResult = { error: null, count: 1 };
  rpcResult = { data: null, error: null };
  mockSupabase.from.mockClear();
  mockSupabase.rpc.mockClear();
});

describe('getJoinQuestionsConfig', () => {
  it('normalizes a fully configured row, trimming the custom question', async () => {
    communitiesSelectResult = {
      data: { join_ask_reason: true, join_ask_source: true, join_ask_rules_confirm: false, join_open_question: '  pick one  ' },
      error: null,
    };
    expect(await getJoinQuestionsConfig('c1')).toEqual({
      askReason: true,
      askSource: true,
      askRulesConfirm: false,
      openQuestion: 'pick one',
    });
  });

  it('treats a whitespace-only custom question as off (null), not an empty string', async () => {
    communitiesSelectResult = {
      data: { join_ask_reason: false, join_ask_source: false, join_ask_rules_confirm: false, join_open_question: '   ' },
      error: null,
    };
    expect((await getJoinQuestionsConfig('c1'))?.openQuestion).toBeNull();
  });

  it('self-flips to null when the columns do not exist yet (migration not applied)', async () => {
    communitiesSelectResult = { data: null, error: { code: '42703', message: 'column does not exist' } };
    expect(await getJoinQuestionsConfig('c1')).toBeNull();
  });
});

describe('updateJoinQuestionsConfig', () => {
  it('writes all four fields, trimming the custom question', async () => {
    updateResult = { error: null, count: 1 };
    const ok = await updateJoinQuestionsConfig('c1', {
      askReason: true,
      askSource: false,
      askRulesConfirm: true,
      openQuestion: '  what do you hope for?  ',
    });
    expect(ok).toBe(true);
    const updateCall = mockCalls.find((c) => c.table === 'communities' && c.method === 'update');
    expect(updateCall?.args[0]).toEqual({
      join_ask_reason: true,
      join_ask_source: false,
      join_ask_rules_confirm: true,
      join_open_question: 'what do you hope for?',
    });
  });

  it('clears the custom question to null when given an empty string', async () => {
    await updateJoinQuestionsConfig('c1', { askReason: false, askSource: false, askRulesConfirm: false, openQuestion: '' });
    const updateCall = mockCalls.find((c) => c.table === 'communities' && c.method === 'update');
    expect((updateCall?.args[0] as { join_open_question: string | null }).join_open_question).toBeNull();
  });

  it('reports failure, not a thrown error, when the write is denied or matches zero rows', async () => {
    updateResult = { error: null, count: 0 };
    const ok = await updateJoinQuestionsConfig('c1', { askReason: true, askSource: false, askRulesConfirm: false, openQuestion: null });
    expect(ok).toBe(false);
  });
});

describe('getCommunityRestrictedGender', () => {
  it('returns the restriction when the community has one', async () => {
    communitiesSelectResult = { data: { restricted_gender: 'woman' }, error: null };
    expect(await getCommunityRestrictedGender('c1')).toBe('woman');
  });

  it('returns null for an open (unrestricted) community', async () => {
    communitiesSelectResult = { data: { restricted_gender: null }, error: null };
    expect(await getCommunityRestrictedGender('c1')).toBeNull();
  });

  it('self-flips to null when the column does not exist yet (migration not applied)', async () => {
    communitiesSelectResult = { data: null, error: { code: '42703', message: 'column does not exist' } };
    expect(await getCommunityRestrictedGender('c1')).toBeNull();
  });
});

describe('getJoinAnswerCards', () => {
  it('shapes the 5 new fields from the RPC projection', async () => {
    rpcResult = {
      data: [
        {
          member_id: 'm1',
          first_name: 'Jamie',
          last_name: 'Rivera',
          area: 'Echo Park',
          intro_answer: 'hi',
          guidelines_accepted_at: '2026-09-04T00:00:00Z',
          reason_answer: 'moving here',
          source_answer: 'a friend',
          rules_confirmed: true,
          open_question: 'what do you hope for?',
          open_answer: 'new friends',
        },
      ],
      error: null,
    };
    const cards = await getJoinAnswerCards('c1');
    expect(cards.get('m1')).toEqual({
      first_name: 'Jamie',
      last_name: 'Rivera',
      area: 'Echo Park',
      intro_answer: 'hi',
      guidelines_accepted_at: '2026-09-04T00:00:00Z',
      reason_answer: 'moving here',
      source_answer: 'a friend',
      rules_confirmed: true,
      open_question: 'what do you hope for?',
      open_answer: 'new friends',
    });
  });

  it('defaults every new field to null when the deployed RPC predates this migration (old 5-column shape)', async () => {
    rpcResult = {
      data: [{ member_id: 'm1', first_name: 'Jamie', last_name: 'Rivera', area: null, intro_answer: 'hi', guidelines_accepted_at: null }],
      error: null,
    };
    const cards = await getJoinAnswerCards('c1');
    expect(cards.get('m1')).toMatchObject({
      reason_answer: null,
      source_answer: null,
      rules_confirmed: null,
      open_question: null,
      open_answer: null,
    });
  });

  it('falls back to the raw table read and still shapes the new fields when the RPC errors', async () => {
    rpcResult = { data: null, error: { message: 'rpc missing' } };
    communityMemberAnswersResult = {
      data: [
        {
          member_id: 'm1',
          answers: {
            first_name: 'Jamie',
            zip: '90026',
            intro_answer: 'hi',
            reason_answer: 'moving here',
            rules_confirmed: true,
            open_answer: 'new friends',
          },
        },
      ],
      error: null,
    };
    const cards = await getJoinAnswerCards('c1');
    const card = cards.get('m1')!;
    expect(card.reason_answer).toBe('moving here');
    expect(card.source_answer).toBeNull();
    expect(card.rules_confirmed).toBe(true);
    expect(card.open_answer).toBe('new friends');
    // no join to communities in this legacy fallback path -- the live
    // question text is only ever available through the RPC projection above
    expect(card.open_question).toBeNull();
  });
});
