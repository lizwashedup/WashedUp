import {pageEventReuseNetwork, createPageEventReuseOperation} from './creatorPageEventReuseOperation';
/** One selected source and one saved destination across initial draft creation. */
import {readPageEventCopyStop,clearPageEventCopyStop} from './creatorPageEventCopyStop';
import {sameEventSaveVersion} from './eventSaveVersion';
import {validEventCategories} from './eventCategories';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {AppState} from 'react-native';
import {supabase} from './supabase';
import {createCreatorPageEventDraft, CreatorPageScopeExpired, type CreatorPageScope} from './creatorPageReview';
import {loadCreatorPageWorkspace} from './creatorPageWorkspace';
import {loadCreatorPageTeamWorkspace} from './creatorPageTeamWorkspace';
import {getPageEventSaveAttempt, getPageEventSaveState, type PageEventSaveReceipt, type PageEventSaveState} from './creatorPageEventSave';
import {getPageEventTemplate} from './creatorPageEventTemplate';
import {mediaUUID} from './creatorPageEventMedia';
import {readPageEventReuse, preparePageEventReuse, startPageEventReuse, acknowledgeKeptPageEventReuse,
  type PageEventReuseSource, type SavedPageEventReuse, type PageEventReuseProgress, type PageEventReuseConflictReason} from './creatorPageEventReuse';

export interface PageEventReuseEntry {
  version: 1; userId: string; pageId: string; eventId: string; source: PageEventReuseSource;
  sourceUpdatedAt: string; title: string; category: string; categories?: string[]; requestId?: string; keeping?: true; kept?: true;
}
export type PageEventReuseEntryState = {
  attempt: PageEventReuseEntry; entry: 'owner' | 'team';
  stage: 'not-created' | 'pending' | 'saved' | 'conflict' | 'stopping' | 'kept'; event?: PageEventSaveState; conflict?: PageEventReuseConflictReason; saved?: PageEventSaveReceipt; cleanupPending?: boolean;
};
const queues = new Map<string, Promise<unknown>>(), active = new Set<string>();
const key = (pageId: string, scope: CreatorPageScope) => `creator-page-event-reuse-entry:v1:${scope.userId}:${pageId}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
function current(pageId: string, scope: CreatorPageScope) {
  if (!scope.isCurrent() || !mediaUUID(pageId) || !mediaUUID(scope.userId)) throw new CreatorPageScopeExpired();
}
function validSource(source: PageEventReuseSource, pageId: string) {
  return source && source.pageId === pageId && mediaUUID(source.eventId)
    && (source.kind === 'event' || source.kind === 'template' && mediaUUID(source.templateId));
}
function sameSource(a: PageEventReuseSource, b: PageEventReuseSource) {
  return a.kind === b.kind && a.pageId === b.pageId && a.eventId === b.eventId
    && (a.kind === 'event' || b.kind === 'template' && a.templateId === b.templateId);
}
async function serial<T>(k: string, work: () => Promise<T>): Promise<T> {
  const pending = (queues.get(k) ?? Promise.resolve()).catch(() => undefined).then(work);
  queues.set(k, pending);
  try { return await pending; } finally { if (queues.get(k) === pending) queues.delete(k); }
}
async function read(pageId: string, scope: CreatorPageScope): Promise<PageEventReuseEntry | null> {
  current(pageId, scope); const raw = await AsyncStorage.getItem(key(pageId, scope)); current(pageId, scope);
  if (raw === null) return null;
  const a = JSON.parse(raw) as PageEventReuseEntry;
  if (!a || a.version !== 1 || a.userId !== scope.userId || a.pageId !== pageId || !mediaUUID(a.eventId)
    || !validSource(a.source, pageId) || a.source.eventId === a.eventId || !timestamp(a.sourceUpdatedAt)
    || typeof a.title !== 'string' || !a.title.trim() || typeof a.category !== 'string' || !a.category.trim()
    || a.categories !== undefined && !validEventCategories(a.categories)
    || a.keeping !== undefined && a.keeping !== true || a.kept !== undefined && (a.kept !== true || !a.keeping)
    || a.requestId !== undefined && !mediaUUID(a.requestId)) throw Error('The original event copy needs to be checked.');
  return a;
}
async function write(a: PageEventReuseEntry, scope: CreatorPageScope) {
  current(a.pageId, scope); await AsyncStorage.setItem(key(a.pageId, scope), JSON.stringify(a)); current(a.pageId, scope);
}
export function readPageEventReuseEntry(pageId: string, scope: CreatorPageScope) {
  return serial(key(pageId, scope), () => read(pageId, scope));
}

/** Only the current account's ownership is probed. Teammate event access then
 * uses its minimal workspace, never another person's application/review. */
export async function getPageEventReuseWorkspace(pageId: string, scope: CreatorPageScope) {
  current(pageId, scope);
  const {data: account, error: authError} = await pageEventReuseNetwork(scope, () => supabase.auth.getUser()); current(pageId, scope);
  if (authError) throw authError; if (account.user?.id !== scope.userId) throw new CreatorPageScopeExpired();
  const {data, error} = await pageEventReuseNetwork(scope, () => supabase.from('creator_page_drafts').select('id').eq('id', pageId).eq('owner_id', scope.userId).maybeSingle());
  current(pageId, scope); if (error) throw error;
  if (data) {
    if (data.id !== pageId) throw Error('Check this page.');
    const page = await pageEventReuseNetwork(scope, networkScope => loadCreatorPageWorkspace(pageId, networkScope)); current(pageId, scope);
    if (!page) throw Error('This page is unavailable.');
    return {entry: 'owner' as const, name: String(page.draft.page_data.name || 'Your page'), events: page.events};
  }
  const page = await pageEventReuseNetwork(scope, networkScope => loadCreatorPageTeamWorkspace(pageId, networkScope)); current(pageId, scope);
  return {entry: 'team' as const, name: page.name, events: page.events};
}
/** Preserve the saved snapshot, including its order. Do not invent a list for
 * legacy sources: a persisted create may already have used the original RPC. */
function selection(fields: {title: string; category: string; categories?: string[]}, updatedAt: string) {
  if (fields.categories !== undefined && !validEventCategories(fields.categories)) throw Error('Check the original event categories.');
  return {title: fields.title, category: fields.category, updatedAt,
    ...(fields.categories === undefined ? {} : {categories: [...fields.categories]})};
}
export async function getPageEventReuseSelection(source: PageEventReuseSource, scope: CreatorPageScope) {
  const s = clone(source); current(s.pageId, scope);
  if (!validSource(s, s.pageId)) throw Error('Choose a saved event or template.');
  if (s.kind === 'template') {
    const template = await pageEventReuseNetwork(scope, networkScope => getPageEventTemplate(s.pageId, s.eventId, s.templateId, networkScope)); current(s.pageId, scope);
    if (!template) throw Error('This template is unavailable.');
    return selection(template.fields, template.sourceUpdatedAt);
  }
  const event = await pageEventReuseNetwork(scope, networkScope => getPageEventSaveState(s.pageId, s.eventId, networkScope)); current(s.pageId, scope);
  return selection(event.fields, event.updatedAt);
}
/** Persist before creating a destination. A new selection cannot replace an
 * unresolved original; callers must show that original after authorization. */
export function preparePageEventReuseEntry(pageId: string, source: PageEventReuseSource, scope: CreatorPageScope) {
  const selected = clone(source); current(pageId, scope);
  if (!validSource(selected, pageId)) throw Error('Choose a source from this page.');
  return serial(key(pageId, scope), async () => {
    const pending = await read(pageId, scope); if (pending) return {attempt: pending, created: false};
    await getPageEventReuseWorkspace(pageId, scope);
    const original = await getPageEventReuseSelection(selected, scope); current(pageId, scope);
    const attempt: PageEventReuseEntry = {version: 1, userId: scope.userId, pageId, eventId: Crypto.randomUUID(), source: selected,
      sourceUpdatedAt: original.updatedAt, title: original.title, category: original.category,
      ...(original.categories === undefined ? {} : {categories: original.categories})};
    await write(attempt, scope); return {attempt, created: true};
  });
}
function matchesWhole(a: PageEventReuseEntry, whole: SavedPageEventReuse) {
  return a.userId === whole.userId && a.pageId === whole.pageId && a.eventId === whole.eventId
    && sameSource(a.source, whole.source) && sameEventSaveVersion(a.sourceUpdatedAt, whole.sourceUpdatedAt)
    && (!a.requestId || a.requestId === whole.requestId);
}
async function inspect(a: PageEventReuseEntry, scope: CreatorPageScope) {
  const workspace = await getPageEventReuseWorkspace(a.pageId, scope);
  if (a.requestId) {
    const requestId = a.requestId;
    const saved = await pageEventReuseNetwork(scope, networkScope => getPageEventSaveAttempt(a.pageId, a.eventId, requestId, networkScope));
    current(a.pageId, scope);
    if (saved) return {workspace, saved};
  }
  return {workspace, saved: undefined};
}

/** Check is read-only at the backend. Retry uses the same creation ID and then
 * the existing complete-copy request. It never publishes or opens an editor. */
export function startPageEventReuseEntry(pageId: string, scope: CreatorPageScope, action: 'check' | 'retry' | 'keep', onProgress?: (p: PageEventReuseProgress) => void) {
  current(pageId, scope);
  if (!['check', 'retry', 'keep'].includes(action)) throw Error('Choose check or resume.');
  const k = key(pageId, scope); if (active.has(k)) throw Error('The original copy is still finishing. Check it again in a moment.');
  active.add(k);
  let transfer: ReturnType<typeof startPageEventReuse> | undefined;
  const operation = createPageEventReuseOperation(scope, () => transfer?.cancel());
  const {scope: owned, cancel} = operation;
  if (AppState.currentState !== 'active') cancel();
  const listener = AppState.addEventListener('change', state => { if (state !== 'active') cancel(); });
  const done = serial(k, async (): Promise<PageEventReuseEntryState> => {
    const a = await read(pageId, owned); if (!a) throw Error('No saved event copy was found.');
    if (action === 'keep' && !a.keeping) { a.keeping = true; await write(a, owned); }
    const {workspace, saved} = await inspect(a, owned); current(pageId, owned);
    let whole = await readPageEventReuse(pageId, a.eventId, owned);
    if (whole && !matchesWhole(a, whole)) throw Error('This draft has a different saved copy. Keep both original attempts.');
    const finish = async (receipt: PageEventSaveReceipt, cleanupPending: boolean): Promise<PageEventReuseEntryState> => {
      // Keep the destination pointer until the creator explicitly opens it.
      // Restarting on this route must show that saved event, not another create.
      current(pageId, owned);
      return {attempt: a, entry: workspace.entry, stage: 'saved', saved: receipt, cleanupPending};
    };
    if (saved && !whole) return finish(saved, false);
    const finishKept = async (event: PageEventSaveState, cleanupPending: boolean): Promise<PageEventReuseEntryState> => {
      a.kept = true; a.keeping = true; await write(a, owned);
      try {
        if (!cleanupPending && whole) cleanupPending = !await acknowledgeKeptPageEventReuse(pageId, a.eventId, whole.requestId, owned);
        if (!cleanupPending) {
          const stop = await readPageEventCopyStop(pageId, a.eventId, owned); current(pageId, owned);
          if (stop) cleanupPending = !await clearPageEventCopyStop(stop, owned);
        }
      } catch { cleanupPending = true; }
      current(pageId, owned);
      return {attempt: a, entry: workspace.entry, stage: 'kept', event, cleanupPending};
    };
    if (a.keeping && !whole && (a.kept || !a.requestId)) {
      if (!workspace.events.some(e => e.id === a.eventId)) {
        if (a.kept) throw Error('The kept event is unavailable.');
        if (action !== 'keep') return {attempt: a, entry: workspace.entry, stage: 'stopping'};
        await pageEventReuseNetwork(owned, networkScope => createCreatorPageEventDraft({pageId, eventId: a.eventId, title: a.title, category: a.category,
          ...(a.categories === undefined ? {} : {categories: [...a.categories]})}, networkScope), 25_000); current(pageId, owned);
      }
      return finishKept(await pageEventReuseNetwork(owned, networkScope => getPageEventSaveState(pageId, a.eventId, networkScope)), false);
    }
    if (!saved && !whole && a.requestId) throw Error('The original complete copy is unavailable. Keep this saved draft for review.');
    if (!saved && !whole) {
      const source = await getPageEventReuseSelection(a.source, owned); current(pageId, owned);
      if (!sameEventSaveVersion(source.updatedAt, a.sourceUpdatedAt)) return {attempt: a, entry: workspace.entry, stage: 'conflict', conflict: 'source'};
    }
    if (action === 'check' && !whole) return {attempt: a, entry: workspace.entry,
      stage: workspace.events.some(e => e.id === a.eventId) ? 'pending' : 'not-created'};
    if (!whole) {
      if (!workspace.events.some(e => e.id === a.eventId)) {
        await pageEventReuseNetwork(owned, networkScope => createCreatorPageEventDraft({pageId, eventId: a.eventId, title: a.title, category: a.category,
          ...(a.categories === undefined ? {} : {categories: [...a.categories]})}, networkScope), 25_000);
        current(pageId, owned);
      }
      whole = (await preparePageEventReuse(pageId, a.eventId, a.source, owned, a.sourceUpdatedAt)).attempt;
      current(pageId, owned);
      if (!matchesWhole(a, whole)) throw Error('The saved copy no longer matches its original source.');
    }
    if (!a.requestId && (action === 'retry' || action === 'keep')) {
      a.requestId = whole.requestId; await write(a, owned);
    }
    transfer = startPageEventReuse(pageId, a.eventId, whole.requestId, owned, a.keeping ? action === 'keep' ? 'keep' : 'check' : action, onProgress);
    const result = await operation.wait(transfer.done); current(pageId, owned);
    if (result.state === 'saved') return finish(result.saved, result.cleanupPending);
    if (result.state === 'kept') return finishKept(result.event, result.cleanupPending);
    if (result.state === 'stopping') return {attempt: a, entry: workspace.entry, stage: 'stopping'};
    if (result.state === 'conflict') return {attempt: a, entry: workspace.entry, stage: 'conflict', conflict: result.reason};
    return {attempt: a, entry: workspace.entry, stage: 'pending'};
  }).finally(() => { operation.finish(); listener.remove(); active.delete(k); });
  return {done, cancel};
}

/** Called only when opening a confirmed destination. A cleanup failure does
 * not undo that save; its original pointer remains available on return. */
export function acknowledgePageEventReuseEntry(attempt: PageEventReuseEntry, scope: CreatorPageScope) {
  const a = clone(attempt); current(a.pageId, scope);
  if ((!a.kept && !a.requestId) || a.requestId !== undefined && !mediaUUID(a.requestId) || a.userId !== scope.userId) throw Error('Check the saved copy first.');
  return serial(key(a.pageId, scope), async () => {
    const pending = await read(a.pageId, scope);
    if (pending && (pending.eventId !== a.eventId || pending.requestId !== a.requestId || !sameSource(pending.source, a.source))) throw Error('A different original copy is pending.');
    if (a.kept) {
      if (pending && !pending.kept) throw Error('Check the kept destination first.');
      await pageEventReuseNetwork(scope, networkScope => getPageEventSaveState(a.pageId, a.eventId, networkScope)); current(a.pageId, scope);
    } else {
      const saved = await pageEventReuseNetwork(scope, networkScope => getPageEventSaveAttempt(a.pageId, a.eventId, a.requestId!, networkScope)); current(a.pageId, scope);
      if (!saved) throw Error('The copied event is not confirmed.');
    }
    if (await readPageEventReuse(a.pageId, a.eventId, scope)) return false;
    const stop = await readPageEventCopyStop(a.pageId, a.eventId, scope); current(a.pageId, scope);
    if (stop && !await clearPageEventCopyStop(stop, scope)) return false;
    current(a.pageId, scope);
    if (pending) {
      try { await AsyncStorage.removeItem(key(a.pageId, scope)); } catch { return false; }
    }
    current(a.pageId, scope); return true;
  });
}
