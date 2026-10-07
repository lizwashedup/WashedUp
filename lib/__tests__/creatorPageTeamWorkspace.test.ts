const mockUser = jest.fn(), mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { auth: { getUser: () => mockUser() }, rpc: (...args: unknown[]) => mockRpc(...args) } }));
import { loadCreatorPageTeamWorkspace } from '../creatorPageTeamWorkspace';
import { CreatorPageReceiptUnknown, CreatorPageScopeExpired } from '../creatorPageReview';
const page = 'f5d7644a-2ff5-4def-b0ab-d04b8250892b', owner = '0e6e1827-0f87-4e03-b42b-7ade8219725b';
const event = { id: '0f740000-0000-4000-8000-000000000011', title: 'Saved event', category: 'Social', status: 'Draft' };
const scope = { userId: 'teammate', isCurrent: () => true };
const payload = { page_id: page, page_kind: 'organization', page_name: 'Our page', owner_id: owner, events: [event] };
beforeEach(() => { jest.resetAllMocks(); mockUser.mockResolvedValue({ data: { user: { id: scope.userId } }, error: null }); mockRpc.mockResolvedValue({ data: payload, error: null }); });
it('reads an exact page projection while retaining the separate owner and saved event identity', async () => {
  await expect(loadCreatorPageTeamWorkspace(page, scope)).resolves.toEqual({ pageId: page, kind: 'organization', name: 'Our page', ownerId: owner, events: [event] });
  expect(mockRpc).toHaveBeenCalledWith('get_creator_page_team_workspace', { p_page_id: page });
});
it('does not dispatch for a different signed-in account', async () => {
  mockUser.mockResolvedValue({ data: { user: { id: 'other' } } });
  await expect(loadCreatorPageTeamWorkspace(page, scope)).rejects.toBeInstanceOf(CreatorPageScopeExpired); expect(mockRpc).not.toHaveBeenCalled();
});
it('retires account changes during preflight without querying another page', async () => {
  let active = true; mockUser.mockImplementation(async () => { active = false; return { data: { user: { id: scope.userId } } }; });
  await expect(loadCreatorPageTeamWorkspace(page, { ...scope, isCurrent: () => active })).rejects.toBeInstanceOf(CreatorPageScopeExpired); expect(mockRpc).not.toHaveBeenCalled();
});
it('discards responses from retired visits', async () => {
  let active = true; mockRpc.mockImplementation(async () => { active = false; return { data: payload }; });
  await expect(loadCreatorPageTeamWorkspace(page, { ...scope, isCurrent: () => active })).rejects.toBeInstanceOf(CreatorPageScopeExpired);
});
it('preserves an access error without converting it into an empty workspace or retrying', async () => {
  const error = { code: '42501' }; mockRpc.mockResolvedValue({ data: null, error });
  await expect(loadCreatorPageTeamWorkspace(page, scope)).rejects.toBe(error); expect(mockRpc).toHaveBeenCalledTimes(1);
});
it.each([
  { ...payload, page_id: owner },
  { ...payload, owner_id: null },
  { ...payload, page_kind: 'unknown' },
  { ...payload, events: [event, event] },
  { ...payload, events: [{ ...event, status: 'unknown' }] },
  { ...payload, events: null },
])('rejects mismatched or ambiguous receipts %#', async data => {
  mockRpc.mockResolvedValue({ data }); await expect(loadCreatorPageTeamWorkspace(page, scope)).rejects.toBeInstanceOf(CreatorPageReceiptUnknown);
});
it('returns only event content projection fields', async () => {
  mockRpc.mockResolvedValue({ data: { ...payload, application: { private: true }, events: [{ ...event, private_note: 'omit' }] } });
  const data = await loadCreatorPageTeamWorkspace(page, scope);
  expect(data).not.toHaveProperty('application'); expect(data.events[0]).not.toHaveProperty('private_note');
});
it('keeps a confirmed empty workspace distinct from failed reads', async () => {
  mockRpc.mockResolvedValue({ data: { ...payload, events: [] } }); await expect(loadCreatorPageTeamWorkspace(page, scope)).resolves.toMatchObject({ events: [] });
});

it('retains saved artwork/date, including an explicitly unscheduled event, without owner-private fields', async () => {
  const rich = { ...event, image_url: 'https://example.test/poster.webp', event_date: '2027-01-10' };
  mockRpc.mockResolvedValue({ data: { ...payload, events: [{ ...rich, private_note: 'omit' }] } });
  expect((await loadCreatorPageTeamWorkspace(page, scope)).events).toEqual([rich]);
  mockRpc.mockResolvedValue({ data: { ...payload, events: [{ ...event, image_url: null, event_date: null }] } });
  expect((await loadCreatorPageTeamWorkspace(page, scope)).events).toEqual([{ ...event, image_url: null, event_date: null }]);
});
it.each([{ image_url: {} }, { event_date: [] }])('rejects malformed optional event context %p', async patch => {
  mockRpc.mockResolvedValue({ data: { ...payload, events: [{ ...event, ...patch }] } });
  await expect(loadCreatorPageTeamWorkspace(page, scope)).rejects.toBeInstanceOf(CreatorPageReceiptUnknown);
});

it('preserves archived event history returned by the same authorized workspace',async()=>{mockRpc.mockResolvedValue({data:{...payload,events:[{...event,status:'Archived'}]},error:null});expect((await loadCreatorPageTeamWorkspace(page,scope)).events[0].status).toBe('Archived');});
