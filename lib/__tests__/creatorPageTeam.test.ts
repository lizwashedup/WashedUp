import { supabase } from '../supabase';
import { createPageTeamInvitation, createPageTeamInvitationWithNote, findPageTeamRecipient, getPageTeamRecipient, getPageTeam, getPageTeamInvitation, getPageTeamInvitationAttempt, resolvePageTeamInvitation, listMyPageTeamInvitations, PageTeamConflictError, type PageTeamInvitation } from '../creatorPageTeam';
jest.mock('../supabase', () => ({ supabase: { auth: { getUser: jest.fn() }, rpc: jest.fn() } }));
const getUser = jest.mocked(supabase.auth.getUser), rpc = jest.mocked(supabase.rpc);
const page = '774c2329-e22e-4113-8a2a-67ca854dd2c9', owner = '0e6e1827-0f87-4e03-b42b-7ade8219725b', recipient = '753c5b17-ca8d-431f-ad8f-0d9b70c0dccb', other = '42c626b4-75e3-40f1-af31-7cd04cd5f809', id = '0f600000-0000-4000-8000-000000000001';
let active = true, userId = owner;
const scope = () => ({ userId, isCurrent: () => active });
const raw = (status = 'pending') => ({ permissions: ['page_content'], current_permissions: null, access_revoked_at: null, invitation_id: id, page_id: page, page_kind: 'community', page_name: 'Example community', inviter_id: owner, recipient_id: recipient, role: 'co_creator', status, created_at: '2026-09-15T00:00:00Z', expires_at: '2026-09-18T00:00:00Z', resolved_at: status === 'pending' ? null : '2026-09-15T01:00:00Z', assignment_id: status === 'accepted' ? other : null });
const observed: PageTeamInvitation = { permissions: ['page_content'], currentPermissions: null, accessRevokedAt: null, invitationId: id, pageId: page, pageKind: 'community', pageName: 'Example community', inviterId: owner, recipientId: recipient, role: 'co_creator', status: 'pending', createdAt: raw().created_at, expiresAt: raw().expires_at, resolvedAt: null, assignmentId: null, note: '', inviterName: 'WashedUp member', recipientName: 'WashedUp member' };
beforeEach(() => { jest.resetAllMocks(); active = true; userId = owner; getUser.mockImplementation(async () => ({ data: { user: { id: userId } }, error: null }) as any); rpc.mockResolvedValue({ data: raw(), error: null } as any); });
it('creates one exact saved attempt without calling any legacy membership RPC', async () => {
  await expect(createPageTeamInvitation(page, id, recipient, scope())).resolves.toEqual(observed);
  expect(rpc.mock.calls).toEqual([['create_creator_page_team_invitation', { p_page_id: page, p_request_id: id, p_recipient_id: recipient }]]);
});
it('retains a deduplicated existing invitation ID', async () => {
  rpc.mockResolvedValue({ data: { ...raw(), invitation_id: other }, error: null } as any);
  expect((await createPageTeamInvitation(page, id, recipient, scope())).invitationId).toBe(other);
});
it.each([{ page_id: other }, { recipient_id: other }, { inviter_id: other }, { status: 'accepted', assignment_id: null }, { status: 'pending', assignment_id: other }, { role: 'admin' }, { page_kind: 'unknown' }, { expires_at: 'bad' }, { expires_at: '2026-09-01T00:00:00Z' }, { resolved_at: '2026-09-15T01:00:00Z' }])('rejects malformed or mismatched create receipt %j', async patch => {
  rpc.mockResolvedValue({ data: { ...raw(), ...patch }, error: null } as any);
  await expect(createPageTeamInvitation(page, id, recipient, scope())).rejects.toThrow('confirmed');
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('keeps an unknown creation separate from read-only resolution of the same attempt', async () => {
  rpc.mockRejectedValueOnce(Error('Response lost'));
  await expect(createPageTeamInvitation(page, id, recipient, scope())).rejects.toThrow('Response lost');
  await expect(getPageTeamInvitationAttempt(page, id, recipient, scope())).resolves.toEqual(observed);
  expect(rpc.mock.calls.map(c => c[0])).toEqual(['create_creator_page_team_invitation', 'get_creator_page_team_invitation_attempt']);
});
it('does not confuse missing attempt with failed recovery', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: null } as any);
  await expect(getPageTeamInvitationAttempt(page, id, recipient, scope())).resolves.toBeNull();
  rpc.mockRejectedValueOnce(Error('Offline'));
  await expect(getPageTeamInvitationAttempt(page, id, recipient, scope())).rejects.toThrow('Offline');
});
it('binds recovered creation to its original recipient', async () => {
  await expect(getPageTeamInvitationAttempt(page, id, other, scope())).rejects.toThrow('could not be confirmed');
});
it('requires exact invitation ID during recipient review', async () => {
  userId = recipient; rpc.mockResolvedValue({ data: { ...raw(), invitation_id: other }, error: null } as any);
  await expect(getPageTeamInvitation(page, id, scope())).rejects.toThrow('could not be confirmed');
});
it.each(['accept', 'decline'] as const)('recipient %s sends only the chosen action and exact page/invite', async action => {
  userId = recipient; rpc.mockResolvedValue({ data: raw(action === 'accept' ? 'accepted' : 'declined'), error: null } as any);
  await expect(resolvePageTeamInvitation(observed, action, scope())).resolves.toMatchObject({ status: action === 'accept' ? 'accepted' : 'declined' });
  expect(rpc.mock.calls).toEqual([['resolve_creator_page_team_invitation', { p_page_id: page, p_invitation_id: id, p_action: action }]]);
});
it('prevents recipient cancel and owner accept before dispatch', async () => {
  await expect(resolvePageTeamInvitation(observed, 'accept', scope())).rejects.toThrow('unavailable');
  userId = recipient; await expect(resolvePageTeamInvitation(observed, 'cancel', scope())).rejects.toThrow('unavailable');
  expect(rpc).not.toHaveBeenCalled();
});
it('exposes saved expiry rather than implying acceptance', async () => {
  userId = recipient; rpc.mockResolvedValue({ data: raw('expired'), error: null } as any);
  await expect(resolvePageTeamInvitation(observed, 'accept', scope())).resolves.toMatchObject({ status: 'expired', assignmentId: null });
});
it('preserves conflict as a check-required outcome without retry', async () => {
  userId = recipient; rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } } as any);
  await expect(resolvePageTeamInvitation(observed, 'accept', scope())).rejects.toBeInstanceOf(PageTeamConflictError);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('rejects a wrong saved action despite a nominal successful response', async () => {
  userId = recipient; rpc.mockResolvedValue({ data: raw('declined'), error: null } as any);
  await expect(resolvePageTeamInvitation(observed, 'accept', scope())).rejects.toThrow('outcome could not be confirmed');
});
it('refuses retired page visits before dispatch', async () => {
  active = false; await expect(createPageTeamInvitation(page, id, recipient, scope())).rejects.toThrow('visit has changed'); expect(rpc).not.toHaveBeenCalled();
});
it('refuses account changes during preflight', async () => {
  const original = scope(); getUser.mockImplementationOnce(async () => { userId = other; return { data: { user: { id: other } }, error: null } as any; });
  await expect(createPageTeamInvitation(page, id, recipient, original)).rejects.toThrow('Sign in again'); expect(rpc).not.toHaveBeenCalled();
});
it('does not expose a saved reply to a retired page visit', async () => {
  rpc.mockImplementationOnce((() => { active = false; return Promise.resolve({ data: raw(), error: null }); }) as any);
  await expect(createPageTeamInvitation(page, id, recipient, scope())).rejects.toThrow('visit has changed'); expect(rpc).toHaveBeenCalledTimes(1);
});
it.each([{ items: [raw(), raw()] }, { items: [{ ...raw(), recipient_id: other }] }, { items: [null] }])('fails closed on duplicated or misbound incoming list %j', async ({ items: data }) => {
  userId = recipient; rpc.mockResolvedValue({ data, error: null } as any);
  await expect(listMyPageTeamInvitations(scope())).rejects.toThrow('confirmed');
});
it('preserves empty and exact recipient lists as separate successful reads', async () => {
  userId = recipient; rpc.mockResolvedValueOnce({ data: [], error: null } as any);
  await expect(listMyPageTeamInvitations(scope())).resolves.toEqual([]);
  rpc.mockResolvedValueOnce({ data: [raw()], error: null } as any);
  await expect(listMyPageTeamInvitations(scope())).resolves.toEqual([observed]);
});

const roster = () => ({ page_id: page, page_kind: 'community', page_name: 'Example community', owner_id: owner, can_invite: userId === owner, assignments: [], legacy_members: [{ member_id: other, user_id: owner, role: 'leader' }], invitations: [] });
it('keeps exact legacy team identities without inventing new assignments', async () => {
  rpc.mockResolvedValue({ data: roster(), error: null } as any);
  await expect(getPageTeam(page, scope())).resolves.toMatchObject({ ownerId: owner, canInvite: true, assignments: [], legacyMembers: [{ memberId: other, userId: owner, role: 'leader' }] });
});
it('keeps unavailable invitation history distinct from a complete review receipt', async () => {
  rpc.mockResolvedValue({ data: { ...roster(), invitations: [{ invitation_id: id, recipient_id: recipient, status: 'pending', available: false }] }, error: null } as any);
  await expect(getPageTeam(page, scope())).resolves.toMatchObject({ invitations: [{ available: false, invitationId: id, recipientId: recipient, status: 'pending' }] });
});
it.each([{ page_id: other }, { can_invite: false }, { assignments: [{ user_id: recipient }] }, { legacy_members: [{ member_id: other, user_id: owner, role: 'finance' }] }, { invitations: [raw()] }])('rejects invalid roster %j', async patch => {
  rpc.mockResolvedValue({ data: { ...roster(), ...patch }, error: null } as any);
  await expect(getPageTeam(page, scope())).rejects.toThrow('could not be confirmed');
});
it('rejects owner invitation history in a delegated roster response', async () => {
  userId = recipient; rpc.mockResolvedValue({ data: { ...roster(), invitations: [{ ...raw(), available: true }] }, error: null } as any);
  await expect(getPageTeam(page, scope())).rejects.toThrow('could not be confirmed');
});
it('preserves distinct legacy membership and current assignment records for recipient roster', async () => {
  userId = recipient; rpc.mockResolvedValue({ data: { ...roster(), assignments: [{ assignment_id: id, user_id: recipient, invitation_id: id, accepted_at: '2026-09-15T01:00:00Z', permissions: ['page_content'], revision: 1, revoked_at: null, role: 'co_creator', available: true }] }, error: null } as any);
  await expect(getPageTeam(page, scope())).resolves.toMatchObject({ canInvite: false, assignments: [{ userId: recipient, available: true }], legacyMembers: [{ userId: owner }] });
});

it('uses the separate exact-handle endpoint and never broadens into legacy partial search', async () => {
  rpc.mockResolvedValue({data:{page_id:page,user_id:recipient,name:'Cedar',photo_url:null},error:null} as any);
  await expect(findPageTeamRecipient(page,' @cedar ',scope())).resolves.toEqual({pageId:page,userId:recipient,name:'Cedar',photoUrl:null});
  expect(rpc.mock.calls).toEqual([['find_creator_page_team_recipient',{p_page_id:page,p_handle:'@cedar'}]]);
});
it('keeps unavailable lookup distinct from a failed lookup', async () => {
  rpc.mockResolvedValueOnce({data:null,error:null} as any);await expect(findPageTeamRecipient(page,'cedar',scope())).resolves.toBeNull();
  rpc.mockRejectedValueOnce(Error('Offline'));await expect(findPageTeamRecipient(page,'cedar',scope())).rejects.toThrow('Offline');
});
it('rechecks selected stable recipient rather than retargeting a renamed handle', async () => {
  rpc.mockResolvedValue({data:{page_id:page,user_id:other,name:'Someone else',photo_url:null},error:null} as any);
  await expect(getPageTeamRecipient(page,recipient,scope())).rejects.toThrow('could not be confirmed');
});
it('passes the reviewed literal note with the exact saved creation attempt', async () => {
  rpc.mockResolvedValue({data:{...raw(),note:'Hello <friends> & neighbors.'},error:null} as any);
  await expect(createPageTeamInvitationWithNote(page,id,recipient,'  Hello <friends> & neighbors.  ',scope())).resolves.toMatchObject({note:'Hello <friends> & neighbors.'});
  expect(rpc.mock.calls).toEqual([['create_creator_page_team_invitation_with_note',{p_page_id:page,p_request_id:id,p_recipient_id:recipient,p_note:'Hello <friends> & neighbors.'}]]);
});
it('does not claim the reviewed note was saved when the note field is missing', async () => {
  await expect(createPageTeamInvitationWithNote(page,id,recipient,'Hello',scope())).rejects.toThrow('could not be confirmed');
});

import { createPageTeamInvitationWithPermissions, changePageTeamAccess, getPageTeamAccessChange, type PageTeamAssignment } from '../creatorPageTeam';
const assignment: PageTeamAssignment = { assignmentId: id, userId: recipient, invitationId: id, acceptedAt: '2026-09-15T01:00:00Z', role: 'co_creator', available: true, name: 'Cedar', permissions: ['page_content'], revision: 1, revokedAt: null };
const changeRaw = () => ({ request_id: other, page_id: page, owner_id: owner, assignment_id: id, user_id: recipient, expected_revision: 1, revision: 2, action: 'edit', permissions: ['page_events'], revoked_at: null });
it('sends only explicit selected permissions through the new server boundary', async () => {
 await createPageTeamInvitationWithPermissions(page,id,recipient,' Hello ',['page_content'],scope());
 expect(rpc).toHaveBeenCalledWith('create_creator_page_team_invitation_with_permissions',{p_page_id:page,p_request_id:id,p_recipient_id:recipient,p_note:'Hello',p_permissions:['page_content']});
});
it.each([{permissions:[]},{permissions:['bank']},{permissions:['page_content','page_content']}])('never sends absent or invalid permissions %j',async ({permissions})=>{
 await expect(createPageTeamInvitationWithPermissions(page,id,recipient,'',permissions as any,scope())).rejects.toThrow('permissions');expect(rpc).not.toHaveBeenCalled();
});
it('rejects missing or organization-incompatible receipt permissions',async()=>{
 for(const permissions of [undefined,['membership_requests']]){rpc.mockResolvedValue({data:{...raw(),page_kind:'organization',permissions},error:null} as any);await expect(createPageTeamInvitationWithPermissions(page,id,recipient,'',['page_content'],scope())).rejects.toThrow('confirmed');}
});
it('recipient cannot accept a selection different from the observed review',async()=>{
 userId=recipient;rpc.mockResolvedValue({data:{...raw('accepted'),permissions:['page_events']},error:null} as any);
 await expect(resolvePageTeamInvitation(observed,'accept',scope())).rejects.toThrow('confirmed');
});
it('binds owner edits to the exact assignment version and checks the saved permissions',async()=>{
 rpc.mockResolvedValue({data:changeRaw(),error:null} as any);
 await expect(changePageTeamAccess(page,other,assignment,'edit',['page_events'],scope())).resolves.toMatchObject({revision:2,permissions:['page_events']});
 expect(rpc).toHaveBeenCalledWith('change_creator_page_team_access',{p_page_id:page,p_request_id:other,p_assignment_id:id,p_expected_revision:1,p_action:'edit',p_permissions:['page_events']});
 rpc.mockResolvedValue({data:{...changeRaw(),permissions:['page_content']},error:null} as any);
 await expect(changePageTeamAccess(page,other,assignment,'edit',['page_events'],scope())).rejects.toThrow('does not match');
});
it.each([{page_id:other},{assignment_id:other},{expected_revision:2,revision:3},{owner_id:recipient},{action:'revoke',revoked_at:null}])('rejects a misbound access change %j',async patch=>{
 rpc.mockResolvedValue({data:{...changeRaw(),...patch},error:null} as any);
 await expect(changePageTeamAccess(page,other,assignment,'edit',['page_events'],scope())).rejects.toThrow();
});
it('unknown access writes are read separately and never automatically replayed',async()=>{
 rpc.mockRejectedValueOnce(Error('Response lost'));await expect(changePageTeamAccess(page,other,assignment,'edit',['page_events'],scope())).rejects.toThrow('lost');
 rpc.mockResolvedValue({data:changeRaw(),error:null} as any);await expect(getPageTeamAccessChange(page,other,scope())).resolves.toMatchObject({revision:2});
 expect(rpc.mock.calls.map(c=>c[0])).toEqual(['change_creator_page_team_access','get_creator_page_team_access_change']);
});
