import { readLoadedTopicEdits, type TopicMessageEdit } from '../topicLoadedHistory';

type StoredMessage = TopicMessageEdit & { topic_id: string };
type ReadRequest = { table: string; topicId?: string; ids: string[] };
const mockRead = jest.fn();
const mockRequests: ReadRequest[] = [];
jest.mock('../supabase', () => ({ supabase: { from: (table: string) => {
  const request: ReadRequest = { table, ids: [] };
  const query: any = {
    select: () => query,
    eq: (column: string, value: string) => {
      if (column === 'topic_id') request.topicId = value;
      return query;
    },
    in: (_column: string, values: string[]) => { request.ids = values; return query; },
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
      mockRequests.push(request);
      return mockRead(request).then(resolve, reject);
    },
  };
  return query;
} } }));

const ids = (count: number) => Array.from({ length: count }, (_, index) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
const row = (id: string, topicId = 'topic-a'): StoredMessage => ({
  id, topic_id: topicId, body: `Edited ${id}`, edited_at: '2026-09-25T08:00:00Z', mention_data: null,
});
const edits = (rows: StoredMessage[]): TopicMessageEdit[] => rows.map(({ topic_id: _topicId, ...message }) => message);
function serve(rows: StoredMessage[]) {
  mockRead.mockImplementation(async (request: ReadRequest) => {
    if (request.table !== 'community_topic_messages') throw Error('Wrong message table');
    if (request.ids.length > 200) throw Error('Request exceeds supported URL size');
    return { data: edits(rows.filter(message => request.ids.includes(message.id)
      && (!request.topicId || message.topic_id === request.topicId))), error: null };
  });
}

beforeEach(() => { mockRead.mockReset(); mockRequests.length = 0; });

it('does not return another topic’s requested message even when it is otherwise readable', async () => {
  const requested = ids(2);
  const own = row(requested[0]), other = row(requested[1], 'topic-b');
  serve([own, other]);
  expect(await readLoadedTopicEdits('topic-a', requested, () => true)).toEqual(edits([own]));
});

it('retrieves every old edit beyond 200 IDs without repeating duplicate input IDs', async () => {
  const requested = ids(407), stored = requested.map(id => row(id));
  serve(stored);
  expect(await readLoadedTopicEdits('topic-a', [...requested, ...requested.slice(0, 10)], () => true))
    .toEqual(edits(stored));
  expect(mockRequests).toHaveLength(3);
  expect(mockRequests.flatMap(request => request.ids)).toEqual(requested);
  expect(mockRequests.every(request => request.topicId === 'topic-a' && request.ids.length <= 200)).toBe(true);
});

it('discards a retired response and does not dispatch the next batch', async () => {
  let current = true;
  mockRead.mockImplementation(async ({ ids: requested }: ReadRequest) => {
    current = false;
    return { data: edits(requested.map(id => row(id))), error: null };
  });
  expect(await readLoadedTopicEdits('topic-a', ids(407), () => current)).toBeNull();
  expect(mockRead).toHaveBeenCalledTimes(1);
});

it('rejects a partial snapshot instead of returning its successful first batch', async () => {
  const requested = ids(201), failure = Error('Later batch unavailable');
  mockRead.mockResolvedValueOnce({ data: edits(requested.slice(0, 200).map(id => row(id))), error: null })
    .mockResolvedValueOnce({ data: null, error: failure });
  await expect(readLoadedTopicEdits('topic-a', requested, () => true)).rejects.toBe(failure);
  expect(mockRead).toHaveBeenCalledTimes(2);
});

it('does not read after retirement or for an empty loaded history', async () => {
  expect(await readLoadedTopicEdits('topic-a', ids(1), () => false)).toBeNull();
  expect(await readLoadedTopicEdits('topic-a', [], () => true)).toEqual([]);
  expect(mockRead).not.toHaveBeenCalled();
});
