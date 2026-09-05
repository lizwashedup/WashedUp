// Liz decision #11 (2026-09-03): up to 3 more optional join questions plus a
// leader-authored open-ended prompt, on top of the always-on public intro.
// Two things matter most here: (1) validateJoinAnswers only requires a slot
// when the community's own config says it is on, and (2) getJoinGate merges
// the new self-flipping config read into the existing gate without ever
// letting a column-absent config read break the base fields that already
// ship today.

type QueryCall = { table: string; method: string; args: unknown[] };

const mockCalls: QueryCall[] = [];
let baseResult: { data: unknown; error: unknown } = { data: null, error: null };
let configResult: { data: unknown; error: unknown } = { data: null, error: null };

function communitiesChain() {
  let cols = '';
  const chain: any = {
    select: (c: string) => {
      cols = c;
      mockCalls.push({ table: 'communities', method: 'select', args: [c] });
      return chain;
    },
    eq: (...args: unknown[]) => {
      mockCalls.push({ table: 'communities', method: 'eq', args });
      return chain;
    },
    maybeSingle: () =>
      Promise.resolve(cols.includes('join_ask_reason') ? configResult : baseResult),
  };
  return chain;
}

const mockSupabase = {
  from: jest.fn((table: string) => {
    if (table === 'communities') return communitiesChain();
    throw new Error(`unexpected table in test: ${table}`);
  }),
};

jest.mock('../supabase', () => ({ supabase: mockSupabase }));

const { getJoinGate, validateJoinAnswers } = require('../communityJoin');

beforeEach(() => {
  mockCalls.length = 0;
  baseResult = { data: null, error: null };
  configResult = { data: null, error: null };
  mockSupabase.from.mockClear();
});

describe('validateJoinAnswers', () => {
  const baseAnswers = {
    first_name: 'Jamie',
    last_name: 'Rivera',
    email: 'jamie@example.com',
    zip: '90210',
    intro_answer: 'hi there',
    guidelines_accepted: true,
  };
  const noExtras = { askReason: false, askSource: false, askRulesConfirm: false, openQuestion: null };

  it('accepts a fully valid baseline submission when no community has any extra question on', () => {
    expect(validateJoinAnswers(baseAnswers, noExtras)).toBeNull();
  });

  it('still enforces the 6 baseline fields exactly as before', () => {
    expect(validateJoinAnswers({ ...baseAnswers, first_name: ' ' }, noExtras)).toMatch(/first name/i);
    expect(validateJoinAnswers({ ...baseAnswers, last_name: ' ' }, noExtras)).toMatch(/last name/i);
    expect(validateJoinAnswers({ ...baseAnswers, email: 'not-an-email' }, noExtras)).toMatch(/email/i);
    expect(validateJoinAnswers({ ...baseAnswers, zip: '123' }, noExtras)).toMatch(/zip/i);
    expect(validateJoinAnswers({ ...baseAnswers, intro_answer: '' }, noExtras)).toMatch(/introduction/i);
    expect(validateJoinAnswers({ ...baseAnswers, guidelines_accepted: false }, noExtras)).toMatch(/guidelines/i);
  });

  it('requires a reason answer only when askReason is on for this community', () => {
    const config = { ...noExtras, askReason: true };
    expect(validateJoinAnswers(baseAnswers, config)).toMatch(/why you want to join/i);
    expect(validateJoinAnswers({ ...baseAnswers, reason_answer: 'moving to the area' }, config)).toBeNull();
    // the same missing field is fine when the community never turned it on
    expect(validateJoinAnswers(baseAnswers, noExtras)).toBeNull();
  });

  it('requires a source answer only when askSource is on for this community', () => {
    const config = { ...noExtras, askSource: true };
    expect(validateJoinAnswers(baseAnswers, config)).toMatch(/heard about/i);
    expect(validateJoinAnswers({ ...baseAnswers, source_answer: 'a friend' }, config)).toBeNull();
  });

  it('requires rules_confirmed to be exactly true only when askRulesConfirm is on -- false is not good enough', () => {
    const config = { ...noExtras, askRulesConfirm: true };
    expect(validateJoinAnswers(baseAnswers, config)).toMatch(/membership requirement/i);
    expect(validateJoinAnswers({ ...baseAnswers, rules_confirmed: false }, config)).toMatch(/membership requirement/i);
    expect(validateJoinAnswers({ ...baseAnswers, rules_confirmed: true }, config)).toBeNull();
  });

  it('requires an open answer only when the community has set a custom open question', () => {
    const config = { ...noExtras, openQuestion: 'what do you hope to get out of this?' };
    expect(validateJoinAnswers(baseAnswers, config)).toMatch(/that answer is required/i);
    expect(validateJoinAnswers({ ...baseAnswers, open_answer: 'new friends' }, config)).toBeNull();
  });

  it('reports the first problem in on-screen field order when several enabled slots are missing', () => {
    const allOn = { askReason: true, askSource: true, askRulesConfirm: true, openQuestion: 'anything else?' };
    // intro comes before reason/source/rules/open-ended on the form, and
    // should be the reported problem even though every later field is also empty
    expect(validateJoinAnswers({ ...baseAnswers, intro_answer: '' }, allOn)).toMatch(/introduction/i);
  });
});

describe('getJoinGate', () => {
  it('merges the base gate with the join-questions config when both reads succeed', async () => {
    baseResult = {
      data: {
        id: 'c1',
        name: 'Sunset Club',
        join_welcome_message: 'hey!',
        join_intro_question: 'fave taco spot?',
        guidelines_url: null,
      },
      error: null,
    };
    configResult = {
      data: {
        join_ask_reason: true,
        join_ask_source: false,
        join_ask_rules_confirm: true,
        join_open_question: '  what do you hope for?  ',
      },
      error: null,
    };

    const gate = await getJoinGate('c1');

    expect(gate).toEqual({
      communityId: 'c1',
      name: 'Sunset Club',
      welcomeMessage: 'hey!',
      introQuestion: 'fave taco spot?',
      guidelinesUrl: null,
      askReason: true,
      askSource: false,
      askRulesConfirm: true,
      openQuestion: 'what do you hope for?',
    });
  });

  it('self-flips to safe defaults when the config columns are not live yet, without breaking the base gate', async () => {
    baseResult = {
      data: { id: 'c1', name: 'Sunset Club', join_welcome_message: null, join_intro_question: null, guidelines_url: null },
      error: null,
    };
    configResult = { data: null, error: { code: '42703', message: 'column "join_ask_reason" does not exist' } };

    const gate = await getJoinGate('c1');

    expect(gate).toEqual({
      communityId: 'c1',
      name: 'Sunset Club',
      welcomeMessage: null,
      introQuestion: null,
      guidelinesUrl: null,
      askReason: false,
      askSource: false,
      askRulesConfirm: false,
      openQuestion: null,
    });
  });

  it('returns null for a community that cannot be found, regardless of the config read', async () => {
    baseResult = { data: null, error: null };
    configResult = { data: null, error: { code: '42703', message: 'column does not exist' } };

    expect(await getJoinGate('missing')).toBeNull();
  });
});
