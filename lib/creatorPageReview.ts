/** Private page-review adapter. Not wired into legacy creator entry points yet.
 * Reuse operatorApplicationForms for application answers. This service never
 * grants account-wide access. Publication is an explicit, separate command.
 * Callers retain IDs and
 * drafts until a receipt or an explicit read resolves an uncertain response.
 */
import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';

export type CreatorPageKind = 'community' | 'organization';
export type PageReviewDecision = 'submitted' | 'approved' | 'needs_more_info' | 'declined';
export interface CreatorPageDraft {
  id: string;
  owner_id: string;
  page_kind: CreatorPageKind;
  page_data: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface CreatorPageSubmission {
  id: string;
  page_id: string;
  revision: number;
  draft_version: number;
  page_snapshot: Record<string, unknown>;
  application: Record<string, unknown>;
  status: PageReviewDecision;
  applicant_message: string | null;
  submitted_at: string;
  terms_accepted_at: string;
  reviewed_at: string | null;
}
export interface CreatorPageScope {
  userId: string;
  /** Account, focused visit and page identity must still belong to this action. */
  isCurrent: () => boolean;
}
export class CreatorPageScopeExpired extends Error {
  constructor() { super('This page visit is no longer active.'); }
}
export class CreatorPageReceiptUnknown extends Error {
  constructor() { super('The saved result could not be confirmed. Check this page before trying again.'); }
}

const assertCurrent = (scope: CreatorPageScope) => {
  if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
};
async function assertAccount(scope: CreatorPageScope) {
  assertCurrent(scope);
  const { data: { user }, error } = await requestWithDeadline(supabase.auth.getUser(), 12_000);
  assertCurrent(scope);
  if (error) throw error;
  if (!user || user.id !== scope.userId) throw new CreatorPageScopeExpired();
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const validDraft = (row: unknown): row is CreatorPageDraft => isRecord(row)
  && typeof row.id === 'string' && typeof row.owner_id === 'string'
  && ['community', 'organization'].includes(row.page_kind as string)
  && Number.isInteger(row.version) && (row.version as number) > 0 && isRecord(row.page_data)
  && typeof row.created_at === 'string' && typeof row.updated_at === 'string';
const validSubmission = (row: unknown): row is CreatorPageSubmission => isRecord(row)
  && typeof row.id === 'string' && typeof row.page_id === 'string'
  && Number.isInteger(row.revision) && (row.revision as number) > 0
  && Number.isInteger(row.draft_version) && (row.draft_version as number) > 0
  && isRecord(row.page_snapshot) && isRecord(row.application)
  && ['submitted', 'approved', 'needs_more_info', 'declined'].includes(row.status as string)
  && (row.applicant_message === null || typeof row.applicant_message === 'string')
  && typeof row.submitted_at === 'string' && typeof row.terms_accepted_at === 'string'
  && (row.reviewed_at === null || typeof row.reviewed_at === 'string');
const draftColumns = 'id,owner_id,page_kind,page_data,version,created_at,updated_at';
const submissionColumns = 'id,page_id,revision,draft_version,page_snapshot,application,status,applicant_message,submitted_at,terms_accepted_at,reviewed_at';

export async function saveCreatorPageDraft(input: {
  id: string; kind: CreatorPageKind; pageData: Record<string, unknown>; expectedVersion: number;
}, scope: CreatorPageScope): Promise<CreatorPageDraft> {
  await assertAccount(scope);
  assertCurrent(scope);
  const { data, error } = await requestWithDeadline(supabase.rpc('save_creator_page_draft', {
    p_page_id: input.id, p_page_kind: input.kind, p_page_data: input.pageData,
    p_expected_version: input.expectedVersion,
  }), 25_000);
  // Retired visits never apply a receipt to a new account/page. The initiating
  // caller retains its attempt ID and can resolve through an owned read later.
  assertCurrent(scope);
  if (error) throw error;
  if (!validDraft(data) || data.id !== input.id || data.owner_id !== scope.userId
    || data.page_kind !== input.kind || data.version !== input.expectedVersion + 1) {
    throw new CreatorPageReceiptUnknown();
  }
  return data;
}

export async function submitCreatorPage(input: {
  pageId: string; submissionId: string; expectedVersion: number;
  application: Record<string, unknown>; acceptTerms: boolean;
}, scope: CreatorPageScope): Promise<CreatorPageSubmission> {
  await assertAccount(scope);
  assertCurrent(scope);
  const { data, error } = await requestWithDeadline(supabase.rpc('submit_creator_page', {
    p_page_id: input.pageId, p_submission_id: input.submissionId,
    p_expected_version: input.expectedVersion, p_application: input.application,
    p_accept_terms: input.acceptTerms,
  }), 25_000);
  assertCurrent(scope);
  if (error) throw error;
  if (!validSubmission(data) || data.id !== input.submissionId || data.page_id !== input.pageId
    || data.draft_version !== input.expectedVersion) throw new CreatorPageReceiptUnknown();
  return data;
}

/** Read-only recovery for the same page and attempt; never retries a mutation. */
export async function loadCreatorPageReview(pageId: string, scope: CreatorPageScope) {
  await assertAccount(scope);
  const draft = await requestWithDeadline(supabase.from('creator_page_drafts').select(draftColumns)
    .eq('id', pageId).eq('owner_id', scope.userId).maybeSingle(), 12_000);
  assertCurrent(scope);
  if (draft.error) throw draft.error;
  if (!draft.data) return null;
  if (!validDraft(draft.data) || draft.data.id !== pageId || draft.data.owner_id !== scope.userId) {
    throw new CreatorPageReceiptUnknown();
  }
  const submissions = await requestWithDeadline(supabase.from('creator_page_submissions').select(submissionColumns)
    .eq('page_id', pageId).order('revision', { ascending: false }), 12_000);
  assertCurrent(scope);
  if (submissions.error) throw submissions.error;
  if (!Array.isArray(submissions.data) || !submissions.data.every(row => validSubmission(row) && row.page_id === pageId)) {
    throw new CreatorPageReceiptUnknown();
  }
  return { draft: draft.data, submissions: submissions.data as CreatorPageSubmission[] };
}

export interface CreatorPagePublication {
  page_id: string;
  submission_id: string;
  owner_id: string;
  page_kind: CreatorPageKind;
  name: string;
  purpose: string;
  city: string;
  description: string | null;
  photo_url: string | null;
  audience: 'everyone' | 'women_only' | 'men_only' | 'nonbinary_only';
  published_at: string;
}

/** Approval never calls this automatically. It is the creator's explicit action. */
export async function publishCreatorPage(input: {
  pageId: string; submissionId: string; kind: CreatorPageKind;
}, scope: CreatorPageScope): Promise<CreatorPagePublication> {
  await assertAccount(scope);
  assertCurrent(scope);
  const { data, error } = await supabase.rpc('publish_creator_page', {
    p_page_id: input.pageId, p_submission_id: input.submissionId,
  });
  assertCurrent(scope);
  if (error) throw error;
  if (!isRecord(data) || data.page_id !== input.pageId || data.submission_id !== input.submissionId
    || data.owner_id !== scope.userId || data.page_kind !== input.kind
    || typeof data.name !== 'string' || typeof data.purpose !== 'string' || typeof data.city !== 'string'
    || !['everyone', 'women_only', 'men_only', 'nonbinary_only'].includes(data.audience as string)
    || typeof data.published_at !== 'string') throw new CreatorPageReceiptUnknown();
  return data as unknown as CreatorPagePublication;
}

/** Allocate the real event once, then continue through the existing full editor. */
export async function createCreatorPageEventDraft(input: {
  pageId: string; eventId: string; title: string; category: string; categories?: string[];
}, scope: CreatorPageScope): Promise<string> {
  await assertAccount(scope);
  assertCurrent(scope);
  const { data, error } = await supabase.rpc(input.categories ? 'create_creator_page_event_draft_with_categories' : 'create_creator_page_event_draft', {
    p_page_id: input.pageId, p_event_id: input.eventId, p_title: input.title, ...(input.categories ? {p_categories:input.categories} : {p_category:input.category}),
  });
  assertCurrent(scope);
  if (error) throw error;
  if (data !== input.eventId) throw new CreatorPageReceiptUnknown();
  return data;
}

/** Publish the saved event, preserving its fields, tickets and existing identity. */
export async function publishCreatorPageEvent(input: {
  pageId: string; eventId: string;
}, scope: CreatorPageScope): Promise<string> {
  await assertAccount(scope);
  assertCurrent(scope);
  const { data, error } = await supabase.rpc('publish_creator_page_event', {
    p_page_id: input.pageId, p_event_id: input.eventId,
  });
  assertCurrent(scope);
  if (error) throw error;
  if (data !== input.eventId) throw new CreatorPageReceiptUnknown();
  return data;
}
