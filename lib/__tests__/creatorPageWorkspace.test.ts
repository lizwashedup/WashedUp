const mockUser = jest.fn(), mockFrom = jest.fn(), mockReview = jest.fn();
jest.mock('../supabase', () => ({ supabase: { auth: { getUser: () => mockUser() }, from: (...args: unknown[]) => mockFrom(...args) } }));
jest.mock('../creatorPageReview', () => ({ ...jest.requireActual('../creatorPageReview'), loadCreatorPageReview: (...args: unknown[]) => mockReview(...args) }));
import { listCreatorPages, loadCreatorPageWorkspace, creatorPagePhase, type CreatorPageWorkspace } from '../creatorPageWorkspace';
const scope = { userId: 'creator', isCurrent: () => true };
const draft = { id: 'page', owner_id: 'creator', page_kind: 'community', page_data: { name: 'Page' }, version: 1, created_at: 'today', updated_at: 'today' };
const submission = { id: 'review', page_id: 'page', draft_version: 1, revision: 1, status: 'approved' };
const page = { draft, submissions: [submission], publication: null, events: [] } as unknown as CreatorPageWorkspace;
function query(data: unknown, error: unknown = null) { const q: any = {}; for (const fn of ['select','eq','in','order','maybeSingle']) q[fn] = jest.fn(() => q); q.then = (resolve: any) => Promise.resolve({ data, error }).then(resolve); return q; }
beforeEach(() => { jest.clearAllMocks(); mockUser.mockResolvedValue({ data: { user: { id: 'creator' } } }); mockReview.mockResolvedValue({ draft, submissions: [submission] }); });
it('keeps approved content editing separate from explicit publication', () => {
  expect(creatorPagePhase(page)).toBe('approved');
  expect(creatorPagePhase({ ...page, draft: { ...page.draft, version: 2 } })).toBe('approved');
  expect(creatorPagePhase({ ...page, submissions: [] })).toBe('draft');
  expect(creatorPagePhase({ ...page, submissions: [{ ...page.submissions[0], status: 'submitted' }] })).toBe('submitted');
  expect(creatorPagePhase({ ...page, publication: {} as any })).toBe('published');
});
it('scopes the list to its owner and rejects an unrelated row', async () => {
  const q = query([draft]); mockFrom.mockReturnValueOnce(q).mockReturnValueOnce(query([]));
  await expect(listCreatorPages(scope)).resolves.toEqual([draft]); expect(q.eq).toHaveBeenCalledWith('owner_id', 'creator');
  mockFrom.mockReturnValue(query([{ ...draft, owner_id: 'other' }])); await expect(listCreatorPages(scope)).rejects.toThrow();
});
it('does not read private pages as another authenticated account', async () => {
  mockUser.mockResolvedValue({ data: { user: { id: 'other' } } });
  await expect(listCreatorPages(scope)).rejects.toThrow(); expect(mockFrom).not.toHaveBeenCalled();
});
it('requires the published receipt to match the page and its approved submission', async () => {
  mockFrom.mockReturnValue(query({ page_id: 'page', submission_id: 'other', owner_id: 'creator', page_kind: 'community', published_at: 'today' }));
  await expect(loadCreatorPageWorkspace('page', scope)).rejects.toThrow();
});
it('keeps the exact saved event and treats missing linked events as unavailable rather than empty', async () => {
  const event = { id: 'event', title: 'Saved', status: 'Draft', category: 'community' };
  mockFrom.mockReturnValueOnce(query(null)).mockReturnValueOnce(query([{ page_id: 'page', event_id: 'event' }])).mockReturnValueOnce(query([event]));
  await expect(loadCreatorPageWorkspace('page', scope)).resolves.toMatchObject({ events: [event], publication: null });
  mockFrom.mockReturnValueOnce(query(null)).mockReturnValueOnce(query([{ page_id: 'page', event_id: 'event' }])).mockReturnValueOnce(query([]));
  await expect(loadCreatorPageWorkspace('page', scope)).rejects.toThrow();
});
it('does not query another page after an unavailable owned read', async () => {
  mockReview.mockResolvedValue(null); await expect(loadCreatorPageWorkspace('page', scope)).resolves.toBeNull(); expect(mockFrom).not.toHaveBeenCalled();
});

it('reads saved event artwork and calendar date for the exact linked event',async()=>{
 const event={id:'event',title:'Sunset together',status:'Draft',category:'community',image_url:'https://example.test/poster.jpg',event_date:'2026-09-19'};const q=query([event]);
 mockFrom.mockReturnValueOnce(query(null)).mockReturnValueOnce(query([{page_id:'page',event_id:'event'}])).mockReturnValueOnce(q);
 expect((await loadCreatorPageWorkspace('page',scope))?.events).toEqual([event]);expect(q.select).toHaveBeenCalledWith('id,title,status,category,image_url,event_date');expect(q.in).toHaveBeenCalledWith('id',['event']);
});

it('shows live identity and confirmed published cover while keeping the private review draft intact',async()=>{
 const pub={page_id:'page',owner_id:'creator',page_kind:'community',name:'Our live name',purpose:'Gather by the water',city:'LA'};
 mockFrom.mockReturnValueOnce(query([draft])).mockReturnValueOnce(query([pub])).mockReturnValueOnce(query([{page_id:'page',media_id:'live-photo'}]));
 const rows=await listCreatorPages(scope);expect(rows[0].page_data).toEqual(draft.page_data);expect(rows[0].published_data).toEqual({...pub,cover_media_id:'live-photo'});
 expect(mockFrom.mock.calls.map(v=>v[0])).toEqual(['creator_page_drafts','creator_page_publications','creator_page_cover_publications']);
});
it('reads the current published cover instead of the originally approved photo',async()=>{
 const pub={page_id:'page',submission_id:'review',owner_id:'creator',page_kind:'community',published_at:'today'};
 mockFrom.mockReturnValueOnce(query(pub)).mockReturnValueOnce(query({page_id:'page',media_id:'new-cover'})).mockReturnValueOnce(query([]));
 expect((await loadCreatorPageWorkspace('page',scope))?.publishedCoverMediaId).toBe('new-cover');
});
it('rejects an unrelated publication or cover in the managed list',async()=>{
 const pub={page_id:'page',owner_id:'creator',page_kind:'community',name:'Our page',purpose:'Meet people',city:'LA'};
 mockFrom.mockReturnValueOnce(query([draft])).mockReturnValueOnce(query([{...pub,owner_id:'another'}]));await expect(listCreatorPages(scope)).rejects.toThrow();
 mockFrom.mockReturnValueOnce(query([draft])).mockReturnValueOnce(query([pub])).mockReturnValueOnce(query([{page_id:'another',media_id:'foreign'}]));await expect(listCreatorPages(scope)).rejects.toThrow();
});
