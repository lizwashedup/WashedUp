import { supabase } from './supabase';

/** The initiating account and focused page visit own every asynchronous result. */
export interface CreatorPageTeamScope { userId: string; isCurrent(): boolean }
export const pageTeamPermissions = ['page_content', 'page_events', 'membership_requests'] as const;
export type PageTeamPermission = typeof pageTeamPermissions[number];
export const pageTeamPermissionLabels: Record<PageTeamPermission, string> = { page_content: 'Page content', page_events: 'Page events', membership_requests: 'Community membership requests' };
export function validPageTeamPermissions(value: unknown, kind?: string, allowEmpty = false): value is PageTeamPermission[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && new Set(value).size === value.length
    && value.every(p => pageTeamPermissions.includes(p) && (kind !== 'organization' || p !== 'membership_requests'));
}
export type PageTeamStatus = 'pending' | 'accepted' | 'declined' | 'canceled' | 'expired';
export type PageTeamAction = 'accept' | 'decline' | 'cancel';
export interface PageTeamInvitation {
  invitationId: string; pageId: string; pageKind: 'community' | 'organization'; pageName: string;
  inviterId: string; recipientId: string; role: 'co_creator'; status: PageTeamStatus;
  createdAt: string; expiresAt: string; resolvedAt: string | null; assignmentId: string | null;
  note: string; inviterName: string; recipientName: string;
  permissions: PageTeamPermission[]; currentPermissions: PageTeamPermission[] | null; accessRevokedAt: string | null;
}
export class PageTeamConflictError extends Error {
  constructor() { super('This invitation has changed. Check its saved outcome.'); }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function current(scope: CreatorPageTeamScope) {
  if (!uuid(scope.userId) || !scope.isCurrent()) throw Error('This page visit has changed.');
}
function target(pageId: string, id: string, scope: CreatorPageTeamScope) {
  current(scope);
  if (!uuid(pageId) || !uuid(id)) throw Error('This invitation is unavailable.');
}
async function account(scope: CreatorPageTeamScope) {
  current(scope);
  const { data, error } = await supabase.auth.getUser();
  current(scope);
  if (error) throw error;
  if (data.user?.id !== scope.userId) throw Error('Sign in again to check this invitation.');
}
function parse(raw: unknown, scope: CreatorPageTeamScope, pageId?: string, invitationId?: string): PageTeamInvitation {
  if (!object(raw) || !uuid(raw.invitation_id) || !uuid(raw.page_id) || !uuid(raw.inviter_id) || !uuid(raw.recipient_id)
    || raw.inviter_id === raw.recipient_id || (scope.userId !== raw.inviter_id && scope.userId !== raw.recipient_id)
    || (pageId !== undefined && raw.page_id !== pageId) || (invitationId !== undefined && raw.invitation_id !== invitationId)
    || !['community', 'organization'].includes(raw.page_kind as string) || typeof raw.page_name !== 'string' || !raw.page_name.trim()
    || (raw.note !== undefined && (typeof raw.note !== 'string' || Array.from(raw.note).length > 1000))
    || !validPageTeamPermissions(raw.permissions, raw.page_kind as string, true)
    || (raw.current_permissions !== null && !validPageTeamPermissions(raw.current_permissions, raw.page_kind as string, true))
    || (raw.access_revoked_at !== null && !timestamp(raw.access_revoked_at))
    || raw.role !== 'co_creator' || !['pending', 'accepted', 'declined', 'canceled', 'expired'].includes(raw.status as string)
    || !timestamp(raw.created_at) || !timestamp(raw.expires_at) || Date.parse(raw.expires_at) <= Date.parse(raw.created_at)
    || (raw.status === 'pending' ? raw.resolved_at !== null : !timestamp(raw.resolved_at))
    || (raw.status === 'accepted' ? !uuid(raw.assignment_id) : raw.assignment_id !== null)) {
    throw Error('The saved invitation could not be confirmed.');
  }
  return { invitationId: raw.invitation_id, pageId: raw.page_id, pageKind: raw.page_kind as PageTeamInvitation['pageKind'], pageName: raw.page_name,
    inviterId: raw.inviter_id, recipientId: raw.recipient_id, role: 'co_creator', status: raw.status as PageTeamStatus,
    note: typeof raw.note === 'string' ? raw.note : '', inviterName: typeof raw.inviter_name === 'string' && raw.inviter_name.trim() ? raw.inviter_name : 'WashedUp member', recipientName: typeof raw.recipient_name === 'string' && raw.recipient_name.trim() ? raw.recipient_name : 'WashedUp member',
    permissions: raw.permissions as PageTeamPermission[], currentPermissions: raw.current_permissions as PageTeamPermission[] | null, accessRevokedAt: raw.access_revoked_at as string | null,
    createdAt: raw.created_at, expiresAt: raw.expires_at, resolvedAt: raw.resolved_at as string | null, assignmentId: raw.assignment_id as string | null };
}
async function rpc(name: string, args: Record<string, unknown>, scope: CreatorPageTeamScope) {
  await account(scope); current(scope);
  const { data, error } = await supabase.rpc(name, args);
  await account(scope);
  if (error?.code === 'PT409') throw new PageTeamConflictError();
  if (error) throw error;
  return data as unknown;
}
/** requestId must be saved before dispatch and reused after an unknown response.
 * A different request may return an existing pending/accepted invitation; the
 * server retains its request mapping. This function never automatically retries. */
export async function createPageTeamInvitation(pageId: string, requestId: string, recipientId: string, scope: CreatorPageTeamScope): Promise<PageTeamInvitation> {
  target(pageId, requestId, scope);
  if (!uuid(recipientId) || recipientId === scope.userId) throw Error('Choose another existing account.');
  const saved = parse(await rpc('create_creator_page_team_invitation', { p_page_id: pageId, p_request_id: requestId, p_recipient_id: recipientId }, scope), scope, pageId);
  if (saved.inviterId !== scope.userId || saved.recipientId !== recipientId) throw Error('The invitation recipient could not be confirmed.');
  return saved;
}
/** Read-only resolution of the same creation attempt. Null means no saved attempt
 * was found on this exact owned page; a failed read remains an error. */
export async function getPageTeamInvitationAttempt(pageId: string, requestId: string, recipientId: string, scope: CreatorPageTeamScope): Promise<PageTeamInvitation | null> {
  target(pageId, requestId, scope);
  if (!uuid(recipientId) || recipientId === scope.userId) throw Error('This invitation attempt is unavailable.');
  const raw = await rpc('get_creator_page_team_invitation_attempt', { p_page_id: pageId, p_request_id: requestId }, scope);
  if (raw === null) return null;
  const saved = parse(raw, scope, pageId);
  if (saved.inviterId !== scope.userId || saved.recipientId !== recipientId) throw Error('The invitation attempt could not be confirmed.');
  return saved;
}
export async function getPageTeamInvitation(pageId: string, invitationId: string, scope: CreatorPageTeamScope): Promise<PageTeamInvitation> {
  target(pageId, invitationId, scope);
  return parse(await rpc('get_creator_page_team_invitation', { p_page_id: pageId, p_invitation_id: invitationId }, scope), scope, pageId, invitationId);
}
export async function resolvePageTeamInvitation(observed: PageTeamInvitation, action: PageTeamAction, scope: CreatorPageTeamScope): Promise<PageTeamInvitation> {
  target(observed.pageId, observed.invitationId, scope);
  if (action === 'accept' && !validPageTeamPermissions(observed.permissions, observed.pageKind)) throw Error('Ask the owner for an invitation with selected permissions.');
  if (!uuid(observed.inviterId) || !uuid(observed.recipientId) || !['accept', 'decline', 'cancel'].includes(action) || (action === 'cancel' ? observed.inviterId : observed.recipientId) !== scope.userId) throw Error('This invitation action is unavailable.');
  const saved = parse(await rpc('resolve_creator_page_team_invitation', { p_page_id: observed.pageId, p_invitation_id: observed.invitationId, p_action: action }, scope), scope, observed.pageId, observed.invitationId);
  const desired: PageTeamStatus = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'canceled';
  if (JSON.stringify(saved.permissions) !== JSON.stringify(observed.permissions) || saved.inviterId !== observed.inviterId || saved.recipientId !== observed.recipientId || (saved.status !== desired && saved.status !== 'expired')) throw Error('The invitation outcome could not be confirmed.');
  return saved;
}
export async function listMyPageTeamInvitations(scope: CreatorPageTeamScope): Promise<PageTeamInvitation[]> {
  current(scope);
  const raw = await rpc('list_my_creator_page_team_invitations', {}, scope);
  if (!Array.isArray(raw)) throw Error('Your invitations could not be checked.');
  const result = raw.map(item => parse(item, scope));
  if (result.some(item => item.recipientId !== scope.userId) || new Set(result.map(item => item.invitationId)).size !== result.length) throw Error('Your invitations could not be confirmed.');
  return result;
}

export interface PageTeamRoster {
  pageId: string; pageKind: 'community' | 'organization'; pageName: string; ownerId: string; ownerName: string | null; canInvite: boolean;
  assignments: { assignmentId: string; userId: string; invitationId: string; acceptedAt: string; role: 'co_creator'; available: boolean; name: string | null; permissions: PageTeamPermission[]; revision: number; revokedAt: string | null }[];
  legacyMembers: { memberId: string; userId: string; role: 'leader' | 'co_leader'; name: string | null }[];
  invitations: ({ available: true; invitation: PageTeamInvitation } | { available: false; invitationId: string; recipientId: string; status: PageTeamStatus })[];
}
/** Preserves legacy member identities alongside separate page assignments. It
 * does not derive new capabilities or expose handles from roster membership. */
export async function getPageTeam(pageId: string, scope: CreatorPageTeamScope): Promise<PageTeamRoster> {
  target(pageId, scope.userId, scope);
  const raw = await rpc('get_creator_page_team', { p_page_id: pageId }, scope);
  const unavailable = () => Error('The page team could not be confirmed.');
  if (!object(raw) || raw.page_id !== pageId || !uuid(raw.owner_id) || !['community', 'organization'].includes(raw.page_kind as string)
    || typeof raw.page_name !== 'string' || !raw.page_name.trim() || typeof raw.can_invite !== 'boolean' || raw.can_invite !== (raw.owner_id === scope.userId)
    || !Array.isArray(raw.assignments) || !Array.isArray(raw.legacy_members) || !Array.isArray(raw.invitations)) throw unavailable();
  const displayName = (v: unknown): string | null => { if (v === undefined || v === null) return null; if (typeof v !== 'string') throw unavailable(); return v.trim() || null; };
  const assignments: PageTeamRoster['assignments'] = raw.assignments.map(item => {
    if (!object(item) || !validPageTeamPermissions(item.permissions, raw.page_kind as string, true) || !Number.isSafeInteger(item.revision) || (item.revision as number) < 1 || (item.revoked_at !== null && !timestamp(item.revoked_at)) || !uuid(item.assignment_id) || !uuid(item.user_id) || !uuid(item.invitation_id) || item.role !== 'co_creator' || typeof item.available !== 'boolean' || !timestamp(item.accepted_at)) throw unavailable();
    return { assignmentId: item.assignment_id, userId: item.user_id, invitationId: item.invitation_id, acceptedAt: item.accepted_at, role: 'co_creator', available: item.available, name: displayName(item.name), permissions: item.permissions as PageTeamPermission[], revision: item.revision as number, revokedAt: item.revoked_at as string | null };
  });
  const legacyMembers: PageTeamRoster['legacyMembers'] = raw.legacy_members.map(item => {
    if (!object(item) || !uuid(item.member_id) || !uuid(item.user_id) || !['leader', 'co_leader'].includes(item.role as string)) throw unavailable();
    return { memberId: item.member_id, userId: item.user_id, role: item.role as 'leader' | 'co_leader', name: displayName(item.name) };
  });
  const invitations: PageTeamRoster['invitations'] = raw.invitations.map(item => {
    if (!object(item) || typeof item.available !== 'boolean') throw unavailable();
    if (item.available) {
      const invitation = parse(item, scope, pageId);
      if (invitation.inviterId !== scope.userId || invitation.pageKind !== raw.page_kind || invitation.pageName !== raw.page_name) throw unavailable();
      return { available: true, invitation };
    }
    if (!uuid(item.invitation_id) || !uuid(item.recipient_id) || !['pending', 'accepted', 'declined', 'canceled', 'expired'].includes(item.status as string)) throw unavailable();
    return { available: false, invitationId: item.invitation_id, recipientId: item.recipient_id, status: item.status as PageTeamStatus };
  });
  const distinct = (ids: string[]) => new Set(ids).size === ids.length;
  if ((!raw.can_invite && invitations.length > 0) || (raw.page_kind === 'organization' && legacyMembers.length > 0)
    || !distinct(assignments.map(a => a.assignmentId)) || !distinct(assignments.filter(a => !a.revokedAt).map(a => a.userId))
    || !distinct(legacyMembers.map(m => m.memberId)) || !distinct(legacyMembers.map(m => m.userId))
    || !distinct(invitations.map(i => i.available ? i.invitation.invitationId : i.invitationId))) throw unavailable();
  return { pageId, pageKind: raw.page_kind as PageTeamRoster['pageKind'], pageName: raw.page_name, ownerId: raw.owner_id, ownerName: displayName(raw.owner_name), canInvite: raw.can_invite, assignments, legacyMembers, invitations };
}

export interface PageTeamPerson { pageId: string; userId: string; name: string; photoUrl: string | null }
function person(raw: unknown, pageId: string, userId?: string): PageTeamPerson {
  if (!object(raw) || raw.page_id !== pageId || !uuid(raw.user_id) || (userId !== undefined && raw.user_id !== userId)
    || typeof raw.name !== 'string' || !raw.name.trim() || (raw.photo_url !== null && typeof raw.photo_url !== 'string')) throw Error('This person could not be confirmed.');
  return { pageId, userId: raw.user_id, name: raw.name, photoUrl: raw.photo_url };
}
export async function findPageTeamRecipient(pageId: string, handle: string, scope: CreatorPageTeamScope): Promise<PageTeamPerson | null> {
  target(pageId, scope.userId, scope);
  if (!handle.trim() || handle.trim().length > 65) throw Error('Enter their exact handle.');
  const raw = await rpc('find_creator_page_team_recipient', { p_page_id: pageId, p_handle: handle.trim() }, scope);
  return raw === null ? null : person(raw, pageId);
}
export async function getPageTeamRecipient(pageId: string, recipientId: string, scope: CreatorPageTeamScope): Promise<PageTeamPerson> {
  target(pageId, recipientId, scope);
  return person(await rpc('get_creator_page_team_recipient', { p_page_id: pageId, p_recipient_id: recipientId }, scope), pageId, recipientId);
}
export async function createPageTeamInvitationWithNote(pageId: string, requestId: string, recipientId: string, note: string, scope: CreatorPageTeamScope): Promise<PageTeamInvitation> {
  target(pageId, requestId, scope);
  if (!uuid(recipientId) || recipientId === scope.userId || typeof note !== 'string' || note.trim().length > 1000) throw Error('Check the person and note before inviting.');
  const raw = await rpc('create_creator_page_team_invitation_with_note', { p_page_id: pageId, p_request_id: requestId, p_recipient_id: recipientId, p_note: note.trim() }, scope);
  const saved = parse(raw, scope, pageId);
  if (!object(raw) || typeof raw.note !== 'string' || saved.inviterId !== scope.userId || saved.recipientId !== recipientId) throw Error('The saved invitation could not be confirmed.');
  // An existing pending invitation can have a different note; always display
  // the confirmed record, never claim the new draft replaced its original note.
  return saved;
}

export async function createPageTeamInvitationWithPermissions(pageId: string, requestId: string, recipientId: string, note: string, permissions: PageTeamPermission[], scope: CreatorPageTeamScope): Promise<PageTeamInvitation> {
  target(pageId, requestId, scope);
  if (!uuid(recipientId) || recipientId === scope.userId || typeof note !== 'string' || Array.from(note.trim()).length > 1000 || !validPageTeamPermissions(permissions)) throw Error('Choose the person and page permissions before inviting.');
  const saved = parse(await rpc('create_creator_page_team_invitation_with_permissions', { p_page_id: pageId, p_request_id: requestId, p_recipient_id: recipientId, p_note: note.trim(), p_permissions: [...permissions].sort() }, scope), scope, pageId);
  if (saved.inviterId !== scope.userId || saved.recipientId !== recipientId) throw Error('The saved invitation could not be confirmed.');
  // An existing invitation retains its original permissions; show that receipt.
  return saved;
}
export type PageTeamAssignment = PageTeamRoster['assignments'][number];
export interface PageTeamAccessChange {
  requestId: string; pageId: string; ownerId: string; assignmentId: string; userId: string;
  expectedRevision: number; revision: number; action: 'edit' | 'revoke'; permissions: PageTeamPermission[]; revokedAt: string | null;
}
function accessChange(raw: unknown, pageId: string, requestId: string, scope: CreatorPageTeamScope): PageTeamAccessChange {
  if (!object(raw) || raw.page_id !== pageId || raw.request_id !== requestId || raw.owner_id !== scope.userId
    || !uuid(raw.assignment_id) || !uuid(raw.user_id) || !Number.isSafeInteger(raw.expected_revision) || (raw.expected_revision as number)<1
    || raw.revision !== (raw.expected_revision as number)+1 || !['edit','revoke'].includes(raw.action as string)
    || !validPageTeamPermissions(raw.permissions, undefined, raw.action === 'revoke')
    || (raw.action === 'revoke' ? (raw.permissions as unknown[]).length !== 0 || !timestamp(raw.revoked_at) : raw.revoked_at !== null)) throw Error('The saved access change could not be confirmed.');
  return { requestId, pageId, ownerId: scope.userId, assignmentId: raw.assignment_id, userId: raw.user_id, expectedRevision: raw.expected_revision as number,
    revision: raw.revision as number, action: raw.action as 'edit' | 'revoke', permissions: raw.permissions as PageTeamPermission[], revokedAt: raw.revoked_at as string | null };
}
export async function getPageTeamAccessChange(pageId: string, requestId: string, scope: CreatorPageTeamScope): Promise<PageTeamAccessChange | null> {
  target(pageId, requestId, scope);
  const raw = await rpc('get_creator_page_team_access_change', { p_page_id: pageId, p_request_id: requestId }, scope);
  return raw === null ? null : accessChange(raw, pageId, requestId, scope);
}
export async function changePageTeamAccess(pageId: string, requestId: string, assignment: PageTeamAssignment, action: 'edit' | 'revoke', permissions: PageTeamPermission[], scope: CreatorPageTeamScope): Promise<PageTeamAccessChange> {
  target(pageId, requestId, scope);
  if (!uuid(assignment.assignmentId) || !uuid(assignment.userId) || !Number.isSafeInteger(assignment.revision) || assignment.revision < 1 || assignment.revokedAt
    || !['edit','revoke'].includes(action) || !validPageTeamPermissions(permissions, undefined, action === 'revoke') || (action === 'revoke' && permissions.length)) throw Error('Refresh this teammate before changing access.');
  const saved = accessChange(await rpc('change_creator_page_team_access', { p_page_id: pageId, p_request_id: requestId, p_assignment_id: assignment.assignmentId,
    p_expected_revision: assignment.revision, p_action: action, p_permissions: [...permissions].sort() }, scope), pageId, requestId, scope);
  if (saved.assignmentId !== assignment.assignmentId || saved.userId !== assignment.userId || saved.expectedRevision !== assignment.revision || saved.action !== action || JSON.stringify(saved.permissions) !== JSON.stringify([...permissions].sort())) throw Error('The saved access change does not match.');
  return saved;
}
