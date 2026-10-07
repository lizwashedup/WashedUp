const mockRpc = jest.fn();
const mockUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('../supabase', () => ({ supabase: {
  auth: { getUser: (...args: unknown[]) => mockUser(...args) },
  rpc: (...args: unknown[]) => mockRpc(...args),
  from: (...args: unknown[]) => mockFrom(...args),
} }));
import { saveCreatorPageDraft, submitCreatorPage, loadCreatorPageReview,
  CreatorPageReceiptUnknown, CreatorPageScopeExpired } from '../creatorPageReview';
const scope = { userId: 'creator', isCurrent: () => true };
const draft = { id: 'page', owner_id: 'creator', page_kind: 'community', page_data: { name: 'Local' },
  version: 1, created_at: '2026-09-14', updated_at: '2026-09-14' };
const input = { id: 'page', kind: 'community' as const, pageData: draft.page_data, expectedVersion: 0 };
const submit = { pageId: 'page', submissionId: 'attempt', expectedVersion: 1,
  application: { why_you: 'Local creator' }, acceptTerms: true };
const submission = { id: 'attempt', page_id: 'page', revision: 1, draft_version: 1, page_snapshot: draft.page_data,
  application: submit.application, status: 'submitted', applicant_message: null,
  submitted_at: '2026-09-14', terms_accepted_at: '2026-09-14', reviewed_at: null };
beforeEach(() => { jest.clearAllMocks(); mockUser.mockResolvedValue({ data: { user: { id: 'creator' } }, error: null }); });
test('retains caller-owned stable ID/version for save and retry', async () => {
  mockRpc.mockResolvedValue({ data: draft, error: null });
  await expect(saveCreatorPageDraft(input, scope)).resolves.toEqual(draft);
  await saveCreatorPageDraft(input, scope);
  expect(mockRpc.mock.calls[0]).toEqual(mockRpc.mock.calls[1]);
  expect(mockRpc).toHaveBeenCalledWith('save_creator_page_draft', {
    p_page_id: 'page', p_page_kind: 'community', p_page_data: draft.page_data, p_expected_version: 0,
  });
});
test.each([null, {}, { ...draft, id: 'other' }, { ...draft, owner_id: 'other' },
  { ...draft, version: 4 }, { ...draft, page_kind: 'organization' }])('does not report malformed/mismatched save as success %#', async data => {
  mockRpc.mockResolvedValue({ data, error: null });
  await expect(saveCreatorPageDraft(input, scope)).rejects.toBeInstanceOf(CreatorPageReceiptUnknown);
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
test('server conflict reaches caller without automatic overwrite/retry', async () => {
  const error = { code: 'PT409', message: 'Page changed' };
  mockRpc.mockResolvedValue({ data: null, error });
  await expect(saveCreatorPageDraft(input, scope)).rejects.toBe(error);
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
test('account switch during preflight prevents dispatch', async () => {
  let current = true;
  mockUser.mockImplementation(async () => { current = false; return { data: { user: { id: 'creator' } }, error: null }; });
  await expect(saveCreatorPageDraft(input, { ...scope, isCurrent: () => current })).rejects.toBeInstanceOf(CreatorPageScopeExpired);
  expect(mockRpc).not.toHaveBeenCalled();
});
test('different authenticated account prevents dispatch', async () => {
  mockUser.mockResolvedValue({ data: { user: { id: 'other' } }, error: null });
  await expect(submitCreatorPage(submit, scope)).rejects.toBeInstanceOf(CreatorPageScopeExpired);
  expect(mockRpc).not.toHaveBeenCalled();
});
test('completion from retired visit cannot update new page', async () => {
  let current = true;
  mockRpc.mockImplementation(async () => { current = false; return { data: draft, error: null }; });
  await expect(saveCreatorPageDraft(input, { ...scope, isCurrent: () => current })).rejects.toBeInstanceOf(CreatorPageScopeExpired);
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
test('submission preserves application and exact page/attempt ID, not account grant', async () => {
  mockRpc.mockResolvedValue({ data: submission, error: null });
  await expect(submitCreatorPage(submit, scope)).resolves.toEqual(submission);
  expect(mockRpc).toHaveBeenCalledWith('submit_creator_page', {
    p_page_id: 'page', p_submission_id: 'attempt', p_expected_version: 1,
    p_application: submit.application, p_accept_terms: true,
  });
});
test.each([null, { ...submission, page_id: 'other' }, { ...submission, draft_version: 2 },
  { ...submission, id: 'different-attempt' }, { ...submission, status: 'published' }])('rejects unconfirmed submission receipt %#', async data => {
  mockRpc.mockResolvedValue({ data, error: null });
  await expect(submitCreatorPage(submit, scope)).rejects.toBeInstanceOf(CreatorPageReceiptUnknown);
});
test('lost submission response can resolve to original already-reviewed record', async () => {
  mockRpc.mockResolvedValue({ data: { ...submission, status: 'approved', reviewed_at: '2026-09-15' }, error: null });
  await expect(submitCreatorPage(submit, scope)).resolves.toMatchObject({ id: 'attempt', status: 'approved' });
});
function readChain(result: unknown) {
  const chain: any = { select: jest.fn(() => chain), eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => result), order: jest.fn(async () => result) };
  return chain;
}
test('read-only recovery uses owned page and preserves review history', async () => {
  const pageRead = readChain({ data: draft, error: null });
  const reviewRead = readChain({ data: [submission], error: null });
  mockFrom.mockReturnValueOnce(pageRead).mockReturnValueOnce(reviewRead);
  await expect(loadCreatorPageReview('page', scope)).resolves.toEqual({ draft, submissions: [submission] });
  expect(pageRead.eq).toHaveBeenCalledWith('owner_id', 'creator');
  expect(reviewRead.eq).toHaveBeenCalledWith('page_id', 'page');
  expect(mockRpc).not.toHaveBeenCalled();
});
test('unavailable private page does not proceed to read submissions', async () => {
  mockFrom.mockReturnValue(readChain({ data: null, error: null }));
  await expect(loadCreatorPageReview('page', scope)).resolves.toBeNull();
  expect(mockFrom).toHaveBeenCalledTimes(1);
});
test('read error stays an error, not an empty page/review state', async () => {
  const error = { message: 'offline' };
  mockFrom.mockReturnValue(readChain({ data: null, error }));
  await expect(loadCreatorPageReview('page', scope)).rejects.toBe(error);
});

describe('explicit publication adapters', () => {
  const api = require('../creatorPageReview');
  const publication = { page_id: 'page', submission_id: 'attempt', owner_id: 'creator', page_kind: 'community',
    name: 'Local community', purpose: 'Meet local people', city: 'Los Angeles', audience: 'everyone', published_at: '2026-09-14' };
  test('publishes only the requested approved page; no event creation side effect', async () => {
    mockRpc.mockResolvedValue({ data: publication, error: null });
    await expect(api.publishCreatorPage({ pageId: 'page', submissionId: 'attempt', kind: 'community' }, scope)).resolves.toEqual(publication);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('publish_creator_page', { p_page_id: 'page', p_submission_id: 'attempt' });
  });
  test.each([{ ...publication, page_id: 'other' }, { ...publication, submission_id: 'older' },
    { ...publication, owner_id: 'other' }, { ...publication, page_kind: 'organization' }, null])('rejects mismatched page publication receipt %#', async data => {
    mockRpc.mockResolvedValue({ data, error: null });
    await expect(api.publishCreatorPage({ pageId: 'page', submissionId: 'attempt', kind: 'community' }, scope)).rejects.toBeInstanceOf(CreatorPageReceiptUnknown);
  });
  test('creates a private event with caller-owned stable ID for the existing editor', async () => {
    mockRpc.mockResolvedValue({ data: 'saved-event', error: null });
    await expect(api.createCreatorPageEventDraft({ pageId: 'page', eventId: 'saved-event', title: 'Local event', category: 'music' }, scope)).resolves.toBe('saved-event');
    expect(mockRpc).toHaveBeenCalledWith('create_creator_page_event_draft', { p_page_id: 'page', p_event_id: 'saved-event', p_title: 'Local event', p_category: 'music' });
  });
  test('publishes the saved event without sending partial editor fields', async () => {
    mockRpc.mockResolvedValue({ data: 'saved-event', error: null });
    await expect(api.publishCreatorPageEvent({ pageId: 'page', eventId: 'saved-event' }, scope)).resolves.toBe('saved-event');
    expect(mockRpc).toHaveBeenCalledWith('publish_creator_page_event', { p_page_id: 'page', p_event_id: 'saved-event' });
  });
  test('page gate conflict is preserved without retrying or duplicating an event', async () => {
    const error = { code: 'PT409', message: 'Publish the approved page first' };
    mockRpc.mockResolvedValue({ data: null, error });
    await expect(api.publishCreatorPageEvent({ pageId: 'page', eventId: 'saved-event' }, scope)).rejects.toBe(error);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
  test('late publication cannot update another page visit', async () => {
    let current = true;
    mockRpc.mockImplementation(async () => { current = false; return { data: 'saved-event', error: null }; });
    await expect(api.publishCreatorPageEvent({ pageId: 'page', eventId: 'saved-event' }, { ...scope, isCurrent: () => current })).rejects.toBeInstanceOf(CreatorPageScopeExpired);
  });
});

test('stalled authorization stops before any later save dispatch',async()=>{
 jest.useFakeTimers();try{let finish!:(v:any)=>void;mockUser.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));const pending=saveCreatorPageDraft(input,scope);const failed=expect(pending).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(12000);await failed;finish({data:{user:{id:'creator'}},error:null});await Promise.resolve();expect(mockRpc).not.toHaveBeenCalled();}finally{jest.useRealTimers();}
});
test.each(['save','submit'])('stalled %s retains its original request arguments without automatic retry',async kind=>{
 jest.useFakeTimers();try{mockRpc.mockReturnValueOnce(new Promise(()=>{}));const pending=kind==='save'?saveCreatorPageDraft(input,scope):submitCreatorPage(submit,scope);const failed=expect(pending).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(25000);await failed;expect(mockRpc).toHaveBeenCalledTimes(1);expect(mockRpc.mock.calls[0][1].p_page_id).toBe('page');if(kind==='submit')expect(mockRpc.mock.calls[0][1].p_submission_id).toBe('attempt');}finally{jest.useRealTimers();}
});
