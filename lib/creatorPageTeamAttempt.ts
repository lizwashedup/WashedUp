import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { validPageTeamPermissions } from './creatorPageTeam';
import type { PageTeamPermission, PageTeamAssignment, CreatorPageTeamScope, PageTeamAction, PageTeamInvitation, PageTeamPerson } from './creatorPageTeam';
export interface PageTeamDraft { handle: string; note: string; person: PageTeamPerson | null; permissions: PageTeamPermission[] }
export type PageTeamOperation = { operationId: string; pageId: string } & (
  { kind: 'create'; recipientId: string; note: string; permissions: PageTeamPermission[] }
  | { kind: 'access'; assignment: PageTeamAssignment; action: 'edit' | 'revoke'; permissions: PageTeamPermission[] }
  | { kind: 'respond'; invitation: PageTeamInvitation; action: PageTeamAction }
);
export interface PageTeamSavedState { version: 1; pageId: string; userId: string; draft: PageTeamDraft; operation: PageTeamOperation | null }
const queues = new Map<string, Promise<unknown>>();
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const key = (pageId: string, scope: CreatorPageTeamScope) => `creator-page-team:v1:${scope.userId}:${pageId}`;
const emptyDraft = (): PageTeamDraft => ({ handle: '', note: '', person: null, permissions: [] });
function current(pageId: string, scope: CreatorPageTeamScope) {
  if (!uuid(pageId) || !uuid(scope.userId) || !scope.isCurrent()) throw Error('This page visit has changed.');
}
async function serial<T>(storageKey: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(storageKey) ?? Promise.resolve()).catch(() => undefined).then(work); queues.set(storageKey, next);
  try { return await next; } finally { if (queues.get(storageKey) === next) queues.delete(storageKey); }
}
function draftValid(d: PageTeamDraft, pageId: string) {
  return d && validPageTeamPermissions(d.permissions, undefined, true) && typeof d.handle === 'string' && d.handle.length <= 65 && typeof d.note === 'string' && d.note.length <= 1000
    && (d.person === null || d.person && d.person.pageId === pageId && uuid(d.person.userId) && typeof d.person.name === 'string' && !!d.person.name.trim() && (d.person.photoUrl === null || typeof d.person.photoUrl === 'string'));
}
function operationValid(o: PageTeamOperation, pageId: string, userId: string) {
  if (!o || o.pageId !== pageId || !uuid(o.operationId)) return false;
  if (o.kind === 'access') return uuid(o.assignment?.assignmentId) && uuid(o.assignment?.userId) && Number.isSafeInteger(o.assignment.revision) && o.assignment.revision > 0 && !o.assignment.revokedAt && ['edit','revoke'].includes(o.action) && validPageTeamPermissions(o.permissions, undefined, o.action === 'revoke') && (o.action !== 'revoke' || o.permissions.length === 0);
  if (o.kind === 'create') return validPageTeamPermissions(o.permissions) && uuid(o.recipientId) && o.recipientId !== userId && typeof o.note === 'string' && o.note.length <= 1000 && o.note === o.note.trim();
  if (o.kind !== 'respond' || !['accept', 'decline', 'cancel'].includes(o.action)) return false;
  const i = o.invitation;
  return i && i.pageId === pageId && uuid(i.invitationId) && uuid(i.inviterId) && uuid(i.recipientId) && i.inviterId !== i.recipientId
    && (o.action === 'cancel' ? i.inviterId : i.recipientId) === userId && i.role === 'co_creator'
    && ['community', 'organization'].includes(i.pageKind) && typeof i.pageName === 'string' && typeof i.note === 'string'
    && ['pending', 'accepted', 'declined', 'canceled', 'expired'].includes(i.status);
}
async function read(pageId: string, scope: CreatorPageTeamScope): Promise<PageTeamSavedState> {
  current(pageId, scope); const raw = await AsyncStorage.getItem(key(pageId, scope)); current(pageId, scope);
  if (!raw) return { version: 1, pageId, userId: scope.userId, draft: emptyDraft(), operation: null };
  const value = JSON.parse(raw) as PageTeamSavedState;
  // Older unsent drafts gain no implicit permissions. Retained operations are
  // never discarded or silently replayed as a full-access request.
  if (value?.draft && !('permissions' in value.draft)) (value.draft as PageTeamDraft).permissions = [];
  if (!value || value.version !== 1 || value.pageId !== pageId || value.userId !== scope.userId || !draftValid(value.draft, pageId)
    || (value.operation !== null && !operationValid(value.operation, pageId, scope.userId))) throw Error('Your saved invitation needs to be checked.');
  return value;
}
async function save(value: PageTeamSavedState, scope: CreatorPageTeamScope) {
  current(value.pageId, scope); await AsyncStorage.setItem(key(value.pageId, scope), JSON.stringify(value)); current(value.pageId, scope);
}
export function readPageTeamState(pageId: string, scope: CreatorPageTeamScope) {
  return serial(key(pageId, scope), () => read(pageId, scope));
}
export function savePageTeamDraft(pageId: string, draft: PageTeamDraft, scope: CreatorPageTeamScope) {
  if (!draftValid(draft, pageId)) return Promise.reject(Error('Check the person and note.'));
  return serial(key(pageId, scope), async () => {
    const saved = await read(pageId, scope);
    if (saved.operation) throw Error('Check the pending invitation first.');
    const next = { ...saved, draft }; await save(next, scope); return next;
  });
}
async function prepare(pageId: string, build: () => PageTeamOperation, scope: CreatorPageTeamScope) {
  return serial(key(pageId, scope), async () => {
    const saved = await read(pageId, scope);
    if (saved.operation) return { operation: saved.operation, created: false };
    const operation = build();
    if (!operationValid(operation, pageId, scope.userId)) throw Error('This invitation attempt is unavailable.');
    await save({ ...saved, operation }, scope);
    return { operation, created: true };
  });
}
/** Store before any network write. Concurrent openings reuse the existing operation. */
export function preparePageTeamCreation(pageId: string, recipientId: string, note: string, scope: CreatorPageTeamScope, permissions: PageTeamPermission[] = []) {
  return prepare(pageId, () => ({ kind: 'create', operationId: Crypto.randomUUID(), pageId, recipientId, note: note.trim(), permissions: [...permissions].sort() }), scope);
}
export function preparePageTeamResponse(invitation: PageTeamInvitation, action: PageTeamAction, scope: CreatorPageTeamScope) {
  return prepare(invitation.pageId, () => ({ kind: 'respond', operationId: Crypto.randomUUID(), pageId: invitation.pageId, invitation, action }), scope);
}
export function preparePageTeamAccess(pageId: string, assignment: PageTeamAssignment, action: 'edit' | 'revoke', permissions: PageTeamPermission[], scope: CreatorPageTeamScope) {
  return prepare(pageId, () => ({ kind: 'access', operationId: Crypto.randomUUID(), pageId, assignment, action, permissions: [...permissions].sort() }), scope);
}
function identity(o: PageTeamOperation) {
  return o.kind === 'access' ? [o.operationId, o.pageId, o.kind, o.assignment.assignmentId, o.assignment.userId, o.assignment.revision, o.action, o.permissions] : o.kind === 'create' ? [o.operationId, o.pageId, o.kind, o.recipientId, o.note, o.permissions]
    : [o.operationId, o.pageId, o.kind, o.invitation.invitationId, o.invitation.inviterId, o.invitation.recipientId, o.action];
}
/** Clear only the exact confirmed operation. A different account/visit/attempt
 * cannot erase pending recovery, including after a late successful response. */
export function clearPageTeamOperation(operation: PageTeamOperation, scope: CreatorPageTeamScope) {
  return serial(key(operation.pageId, scope), async () => {
    const saved = await read(operation.pageId, scope);
    if (!saved.operation || JSON.stringify(identity(saved.operation)) !== JSON.stringify(identity(operation))) return false;
    await save({ ...saved, operation: null, draft: operation.kind === 'create' ? emptyDraft() : saved.draft }, scope); return true;
  });
}
