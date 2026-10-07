/** Private page composer state. Public page data never contains creator answers. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';
import { communityClassificationProblems } from './communityClassification';
import { readPageCoverAttempt, pageCoverActionPending, clearPageCoverAttempt, type PageCoverAttempt, type PageCoverMedia } from './creatorPageMedia';
import { CreatorPageScopeExpired, loadCreatorPageReview, saveCreatorPageDraft, submitCreatorPage,
  type CreatorPageKind, type CreatorPageScope, type CreatorPageDraft } from './creatorPageReview';
export type PageAudience = 'everyone' | 'women_only' | 'men_only' | 'nonbinary_only';
export interface PageCreatorInformation { name: string; email: string; motivation: string; guidelines: boolean; }
export interface PageEditorRecord {
  id: string; kind: CreatorPageKind; version: number; pageData: Record<string, unknown>;
  creator: PageCreatorInformation;
  pending?: { kind: 'save'; pageData: Record<string, unknown>; expectedVersion: number }
    | { kind: 'submit'; submissionId: string; expectedVersion: number; application: Record<string, unknown> };
}
const prefix = (uid: string) => `creator-page-editor:v1:${uid}:`;
const key = (id: string, scope: CreatorPageScope) => prefix(scope.userId) + id;
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
const writes = new Map<string, Promise<void>>();
const starts = new Map<string, Promise<PageEditorRecord>>();
export const pageValue = (data: Record<string, unknown>, field: string) => typeof data[field] === 'string' ? data[field] as string : '';
export const emptyPageCreator = (): PageCreatorInformation => ({ name: '', email: '', motivation: '', guidelines: false });
export const pageAudienceOptions = (gender: string | null | undefined) => [
  { key: 'everyone', label: 'Everyone' },
  ...(gender === 'woman' ? [{ key: 'women_only', label: 'Women only' }] : gender === 'man' ? [{ key: 'men_only', label: 'Men only' }]
    : gender === 'non_binary' ? [{ key: 'nonbinary_only', label: 'Non-binary only' }] : []),
];
export function pageDraftProblems(record: PageEditorRecord, gender: string | null) {
  const errors: Record<string, string> = {};
  const check = (field: string, min: number, max: number, label: string) => {
    const value = pageValue(record.pageData, field).trim();
    if (value.length < min || value.length > max) errors[field] = `${label} needs ${min}–${max} characters.`;
  };
  check('name', 2, 60, 'Page name'); check('purpose', 10, 140, 'Purpose'); check('city', 2, 60, 'City');
  if (record.kind === 'community') Object.assign(errors, communityClassificationProblems(record.pageData));
  const audience = pageValue(record.pageData, 'audience') || 'everyone';
  if (record.kind === 'organization' ? audience !== 'everyone' : !pageAudienceOptions(gender).some(o => o.key === audience)) errors.audience = 'Choose an audience available for your profile.';
  return errors;
}
export function pageCreatorProblems(info: PageCreatorInformation) {
  const errors: Record<string, string> = {};
  if (!info.name.trim() || info.name.trim().length > 80) errors.name = 'Add your name (up to 80 characters).';
  if (info.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email.trim())) errors.email = 'Enter a valid contact email.';
  if (!info.motivation.trim() || info.motivation.trim().length > 300) errors.motivation = 'Tell us how you’ll look after this space (up to 300 characters).';
  if (!info.guidelines) errors.guidelines = 'Agree to the creator and community guidelines.';
  return errors;
}
export function buildPageCreatorInformation(info: PageCreatorInformation) {
  return { your_name: info.name.trim(), contact_email: info.email.trim(), why_you: info.motivation.trim(), creator_guidelines: info.guidelines };
}
function validRecord(value: unknown, id: string): value is PageEditorRecord {
  const r = value as PageEditorRecord;
  const pending = r?.pending;
  const validPending = !pending || (Number.isInteger(pending.expectedVersion) && pending.expectedVersion >= 0
    && (pending.kind === 'save' ? !!pending.pageData && typeof pending.pageData === 'object' && !Array.isArray(pending.pageData)
      : pending.kind === 'submit' && typeof pending.submissionId === 'string' && !!pending.application && typeof pending.application === 'object' && !Array.isArray(pending.application)));
  return validPending && !!r && r.id === id && ['community', 'organization'].includes(r.kind) && Number.isInteger(r.version) && r.version >= 0
    && !!r.pageData && typeof r.pageData === 'object' && !Array.isArray(r.pageData) && !!r.creator
    && ['name', 'email', 'motivation'].every(k => typeof r.creator[k as 'name'] === 'string')
    && typeof r.creator.guidelines === 'boolean';
}
/** Queued local writes retain the initiating account key across navigation. No RPCs. */
export async function persistPageEditor(record: PageEditorRecord, scope: CreatorPageScope) {
  current(scope);
  const storageKey = key(record.id, scope), value = JSON.stringify(record);
  const prior = writes.get(storageKey) ?? Promise.resolve();
  const write = prior.catch(() => undefined).then(() => AsyncStorage.setItem(storageKey, value));
  writes.set(storageKey, write);
  try { await write; } finally { if (writes.get(storageKey) === write) writes.delete(storageKey); }
  current(scope);
}
class MalformedPageEditorRecord extends Error {
  constructor() { super('Could not read the saved page draft.'); }
}
export async function readPageEditor(id: string, scope: CreatorPageScope) {
  current(scope); const storageKey = key(id, scope); await writes.get(storageKey);
  const raw = await AsyncStorage.getItem(storageKey); current(scope);
  if (raw === null) return null;
  let record: unknown;
  try { record = JSON.parse(raw); } catch { throw new MalformedPageEditorRecord(); }
  if (!validRecord(record, id)) throw new MalformedPageEditorRecord();
  return record;
}
async function readLocalPageEditors(scope: CreatorPageScope, skipMalformed = false) {
  current(scope); const keys = await AsyncStorage.getAllKeys(); current(scope);
  const ids = keys.filter(k => k.startsWith(prefix(scope.userId))).map(k => k.slice(prefix(scope.userId).length));
  const records = await Promise.all(ids.map(async id => {
    try { return await readPageEditor(id, scope); }
    catch (failure) {
      // Reuse scanning can ignore damaged candidates without deleting them.
      // Directory reads stay strict; storage I/O and scope failures always fail.
      if (skipMalformed && failure instanceof MalformedPageEditorRecord) return null;
      throw failure;
    }
  })); current(scope);
  return records.filter((r): r is PageEditorRecord => !!r);
}
const initialPageData = () => ({ name: '', purpose: '', city: 'Los Angeles', audience: 'everyone' });
/** Only the exact untouched reservation is reusable; unknown data stays recoverable. */
function hasInitialFields(record: PageEditorRecord) {
  const keys = Object.keys(record);
  return keys.length === 5 && keys.every(key => ['id', 'kind', 'version', 'pageData', 'creator'].includes(key))
    && record.version === 0 && record.kind === 'community' && !record.pending
    && samePageData(record.pageData, initialPageData()) && samePageData({ ...record.creator }, { ...emptyPageCreator() });
}
async function untouchedReservation(record: PageEditorRecord, scope: CreatorPageScope) {
  current(scope);
  if (!hasInitialFields(record) || pageCoverActionPending(record.id, scope)) return false;
  try {
    const photo = await readPageCoverAttempt(record.id, scope); current(scope);
    return !photo && !pageCoverActionPending(record.id, scope);
  } catch {
    // An unreadable photo marker is work to recover, not an empty editor.
    current(scope); return false;
  }
}
export async function listLocalPageEditors(scope: CreatorPageScope) {
  const records = await readLocalPageEditors(scope);
  const visible = await Promise.all(records.map(async record => {
    if (!await untouchedReservation(record, scope)) return record;
    const latest = await readPageEditor(record.id, scope);
    return latest && !await untouchedReservation(latest, scope) ? latest : null;
  })); current(scope);
  return visible.filter((record): record is PageEditorRecord => !!record);
}
async function reservePageEditor(scope: CreatorPageScope, onPrepared?: (record: PageEditorRecord) => void): Promise<PageEditorRecord> {
  current(scope);
  // Keep the durable ID needed by route/recovery, without accumulating visible
  // drafts each time an untouched form is opened and left.
  for (const record of await readLocalPageEditors(scope, true)) {
    if (await untouchedReservation(record, scope)) {
      // A queued edit may have completed while the photo marker was read.
      const latest = await readPageEditor(record.id, scope);
      if (latest && await untouchedReservation(latest, scope)) { current(scope); onPrepared?.(latest); return latest; }
    }
  }
  current(scope);
  const record: PageEditorRecord = { id: Crypto.randomUUID(), kind: 'community', version: 0,
    pageData: initialPageData(), creator: emptyPageCreator() };
  // Expose the original identity before storage can stall. Recovery reads this
  // same draft; the actual serialized write remains owned until it settles.
  onPrepared?.(record);
  await persistPageEditor(record, scope); return record;
}
export async function startPageEditor(scope: CreatorPageScope, onPrepared?: (record: PageEditorRecord) => void): Promise<PageEditorRecord> {
  current(scope);
  // Distinct mounted visits must not both miss an as-yet unwritten reservation.
  // Each queued visit checks its own scope; an earlier write retains ownership.
  const previous = starts.get(scope.userId) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(() => reservePageEditor(scope, onPrepared));
  starts.set(scope.userId, pending);
  try { return await pending; }
  finally { if (starts.get(scope.userId) === pending) starts.delete(scope.userId); }
}
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}` : JSON.stringify(value) ?? 'null';
export const samePageData = (a: Record<string, unknown>, b: Record<string, unknown>) => canonical(a) === canonical(b);
export async function loadPageEditing(id: string, scope: CreatorPageScope) {
  const review = await loadCreatorPageReview(id, scope);
  const local = await readPageEditor(id, scope);
  let coverAttempt: PageCoverAttempt | null = null, coverAttemptError: string | null = null;
  try { coverAttempt = await readPageCoverAttempt(id, scope); }
  catch { current(scope); coverAttemptError = 'The saved photo selection could not be read. Retry, or reset the selection to choose again. Your saved page cover stays unchanged.'; }
  const profile = await requestWithDeadline(supabase.from('profiles').select('id,gender').eq('id', scope.userId).maybeSingle(), 12_000);
  current(scope); if (profile.error) throw profile.error;
  if (!profile.data || profile.data.id !== scope.userId) throw new Error('Could not check your profile.');
  const publication = await requestWithDeadline(supabase.from('creator_page_publications').select('page_id').eq('page_id', id).maybeSingle(), 12_000);
  current(scope); if (publication.error) throw publication.error;
  const latest = review?.submissions[0];
  const fromServer: PageEditorRecord | null = review ? { id, kind: review.draft.page_kind, version: review.draft.version,
    pageData: review.draft.page_data, creator: latest ? { name: String(latest.application.your_name || ''),
      email: String(latest.application.contact_email || ''), motivation: String(latest.application.why_you || ''), guidelines: false } : emptyPageCreator() } : null;
  let record = local ?? fromServer;
  if (!record) return null;
  let confirmedSubmission = false;
  const pendingSubmission = record.pending?.kind === 'submit' ? record.pending : null;
  if (record.pending?.kind === 'save' && review?.draft.version === record.pending.expectedVersion + 1
    && samePageData(review.draft.page_data, record.pending.pageData)) {
    record = { ...record, version: review.draft.version, pending: undefined }; await persistPageEditor(record, scope).catch(() => undefined); current(scope);
  } else if (pendingSubmission && review?.submissions.some(s => s.id === pendingSubmission.submissionId && s.draft_version === pendingSubmission.expectedVersion && samePageData(s.application, pendingSubmission.application))) {
    record = { ...record, pending: undefined }; confirmedSubmission = true; await persistPageEditor(record, scope).catch(() => undefined); current(scope);
  }
  const conflict = !!review && review.draft.version !== record.version;
  return { record, saved: review?.draft ?? null, fromServer, submissions: review?.submissions ?? [],
    coverAttempt, coverAttemptError, gender: profile.data.gender as string | null, published: !!publication.data, conflict, confirmedSubmission };
}
export async function savePageEditing(record: PageEditorRecord, saved: CreatorPageDraft | null, scope: CreatorPageScope) {
  if (record.pending?.kind === 'submit') throw new Error('Check the pending submission first.');
  if (!record.pending && saved?.version === record.version && samePageData(saved.page_data, record.pageData)) {
    await persistPageEditor(record, scope); return record;
  }
  const attempt: PageEditorRecord = record.pending ? record : { ...record,
    pending: { kind: 'save', expectedVersion: record.version, pageData: record.pageData } };
  await persistPageEditor(attempt, scope);
  const pending = attempt.pending!;
  if (pending.kind !== 'save') throw new Error('Check the pending submission first.');
  const result = await saveCreatorPageDraft({ id: record.id, kind: record.kind, pageData: pending.pageData, expectedVersion: pending.expectedVersion }, scope);
  const confirmed = { ...attempt, version: result.version, pending: undefined };
  // The server receipt is final even when local recovery-marker cleanup fails.
  await persistPageEditor(confirmed, scope).catch(() => undefined); current(scope); return confirmed;
}
export async function submitPageEditing(record: PageEditorRecord, scope: CreatorPageScope) {
  if (record.pending?.kind === 'save') throw new Error('Check the pending page save first.');
  if (!record.pending && record.kind === 'community') {
    const classification = communityClassificationProblems(record.pageData);
    if (Object.keys(classification).length) throw new Error(Object.values(classification)[0]);
  }
  if (Object.keys(pageCreatorProblems(record.creator)).length) throw new Error('Complete your creator information and guidelines agreement.');
  const attempt: PageEditorRecord = record.pending ? record : { ...record, pending: { kind: 'submit', submissionId: Crypto.randomUUID(),
    expectedVersion: record.version, application: buildPageCreatorInformation(record.creator) } };
  await persistPageEditor(attempt, scope);
  const pending = attempt.pending!;
  if (pending.kind !== 'submit') throw new Error('Check the pending save first.');
  const result = await submitCreatorPage({ pageId: record.id, submissionId: pending.submissionId, expectedVersion: pending.expectedVersion,
    application: pending.application, acceptTerms: true }, scope);
  await persistPageEditor({ ...attempt, pending: undefined }, scope).catch(() => undefined); current(scope); return result;
}

/** Attach only a confirmed upload, retaining recovery until the editor copy is durable. */
export async function attachPageCover(record: PageEditorRecord, attempt: PageCoverAttempt, media: PageCoverMedia, scope: CreatorPageScope): Promise<PageEditorRecord> {
  current(scope);
  if (record.pending || record.id !== attempt.pageId || media.page_id !== record.id || media.id !== attempt.mediaId
    || media.created_by !== scope.userId || !media.ready_at || media.byte_size !== attempt.byteSize || media.mime_type !== attempt.mimeType) {
    throw new Error('Check the saved page and photo before continuing.');
  }
  const pageData = { ...record.pageData, cover_media_id: media.id };
  delete (pageData as Record<string, unknown>).photo_url;
  const next = { ...record, pageData, creator: { ...record.creator, guidelines: false } };
  await persistPageEditor(next, scope); current(scope);
  // The durable editor copy is authoritative even if marker/file cleanup fails.
  await clearPageCoverAttempt(attempt, scope).catch(() => undefined); current(scope);
  return next;
}
