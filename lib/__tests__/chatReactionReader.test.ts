import { readLoadedChatReactions, type ChatReactionRow } from '../chatReactionReader';

const mockRead = jest.fn();
const mockRequests: Array<{ ids: string[]; from: number; to: number }> = [];
jest.mock('../supabase', () => ({ supabase: { from: () => {
  let ids: string[] = [];
  const query: any = {
    select: () => query,
    in: (_column: string, selected: string[]) => { ids = selected; return query; },
    order: () => query,
    range: (from: number, to: number) => {
      mockRequests.push({ ids, from, to });
      return mockRead({ ids, from, to });
    },
  };
  return query;
} } }));

const ids = (count: number) => Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
const row = (messageId: string, userId = 'member'): ChatReactionRow => ({ message_id: messageId, user_id: userId, reaction: 'heart' });
beforeEach(() => { mockRequests.length = 0; mockRead.mockReset(); });

it('keeps long loaded-history requests within the URL limit and retains every reaction', async () => {
  const history = ids(1307);
  mockRead.mockImplementation(async ({ ids: selected }) => {
    if (selected.join(',').length > 8000) throw Error('Bad Request');
    return { data: selected.map((id: string) => row(id)), error: null };
  });
  const result = await readLoadedChatReactions(history, () => true);
  expect(result?.map(reaction => reaction.message_id)).toEqual(history);
  expect(mockRequests.every(request => request.ids.join(',').length <= 8000)).toBe(true);
});

it('retrieves reactions beyond the response row limit instead of clearing unseen members', async () => {
  const messageId = ids(1)[0];
  const reactions = Array.from({ length: 1207 }, (_, i) => row(messageId, `member-${i}`));
  mockRead.mockImplementation(async ({ from, to }) => ({ data: reactions.slice(from, to + 1), error: null }));
  expect(await readLoadedChatReactions([messageId], () => true)).toEqual(reactions);
  expect(mockRequests.at(-1)?.from).toBe(1000);
});

it('rejects an incomplete refresh so the caller can retain the last confirmed badges', async () => {
  mockRead.mockResolvedValueOnce({ data: [row(ids(1)[0])], error: null })
    .mockResolvedValueOnce({ data: null, error: Error('Connection lost') });
  await expect(readLoadedChatReactions(ids(201), () => true)).rejects.toThrow('Connection lost');
});

it('retires a response and never dispatches another page after leaving the room', async () => {
  let current = true;
  mockRead.mockImplementation(async () => { current = false; return { data: [row(ids(1)[0])], error: null }; });
  expect(await readLoadedChatReactions(ids(401), () => current)).toBeNull();
  expect(mockRead).toHaveBeenCalledTimes(1);
});

it('does not read when already retired or when no loaded messages exist', async () => {
  expect(await readLoadedChatReactions(ids(1), () => false)).toBeNull();
  expect(await readLoadedChatReactions([], () => true)).toEqual([]);
  expect(mockRead).not.toHaveBeenCalled();
});
