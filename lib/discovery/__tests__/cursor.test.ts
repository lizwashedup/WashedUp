import { decodeDiscoveryCursor, encodeDiscoveryCursor, paginateDiscoveryCandidates } from '../cursor';

const candidate = (kind: string, id: string, score: number, sortTime: string) => ({
  kind,
  id,
  score,
  sortTime,
  payload: { id },
});
const candidates = [
  candidate('community', 'c1', 2, '2026-08-16T10:00:00.000Z'),
  candidate('plan', 'p1', 3, '2026-08-16T09:00:00.000Z'),
  candidate('event', 'e1', 3, '2026-08-16T11:00:00.000Z'),
  candidate('plan', 'p2', 2, '2026-08-16T10:00:00.000Z'),
];

describe('mixed discovery cursor contract', () => {
  it('sorts mixed object types using precomputed score and stable tie breakers', () => {
    const page = paginateDiscoveryCandidates(candidates, null, 10);
    expect(page?.items.map((item) => item.id)).toEqual(['e1', 'p1', 'c1', 'p2']);
  });

  it('paginates without duplicates or omissions', () => {
    const first = paginateDiscoveryCandidates(candidates, null, 2)!;
    const second = paginateDiscoveryCandidates(candidates, first.nextCursor, 2)!;
    expect(first.items.map((item) => item.id)).toEqual(['e1', 'p1']);
    expect(second.items.map((item) => item.id)).toEqual(['c1', 'p2']);
    expect(second.nextCursor).toBeNull();
  });

  it('round-trips a versioned cursor', () => {
    const encoded = encodeDiscoveryCursor(candidates[0] as Parameters<typeof encodeDiscoveryCursor>[0]);
    expect(decodeDiscoveryCursor(encoded)).toEqual({
      version: 1,
      kind: 'community',
      id: 'c1',
      score: 2,
      sortTime: '2026-08-16T10:00:00.000Z',
    });
  });

  it('fails closed for invalid cursors, limits, and candidates', () => {
    expect(paginateDiscoveryCandidates(candidates, 'not-json', 2)).toBeNull();
    expect(paginateDiscoveryCandidates(candidates, null, 0)).toBeNull();
    expect(paginateDiscoveryCandidates([...candidates, candidate('person', 'x', 10, '2026-08-16T12:00:00.000Z')], null, 2)).toBeNull();
  });
});
