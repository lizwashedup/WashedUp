import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { useCreatorPageScope } from './useCreatorPageScope';
import { createPageTeamInvitationWithPermissions, changePageTeamAccess, getPageTeamAccessChange, validPageTeamPermissions, findPageTeamRecipient, getPageTeam, getPageTeamInvitation,
  getPageTeamInvitationAttempt, getPageTeamRecipient, resolvePageTeamInvitation,
  type PageTeamPermission, type PageTeamAssignment, type PageTeamAccessChange, type CreatorPageTeamScope, type PageTeamAction, type PageTeamInvitation, type PageTeamRoster } from '../lib/creatorPageTeam';
import { clearPageTeamOperation, preparePageTeamAccess, preparePageTeamCreation, preparePageTeamResponse, readPageTeamState, savePageTeamDraft,
  type PageTeamDraft, type PageTeamOperation } from '../lib/creatorPageTeamAttempt';

/** Explicit review and durable recovery through the existing account/page scope.
 * Mount, focus and foreground return only read; they never replay a saved action. */
export function useCreatorPageTeam(pageId: string, invitationId?: string) {
  const context = useCreatorPageScope(pageId), base = context.scope;
  const mounted = useRef(false), foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const state = useMemo(() => ({ loaded: false, busy: false, roster: null as PageTeamRoster | null, invitation: null as PageTeamInvitation | null,
    draft: { handle: '', note: '', person: null, permissions: [] } as PageTeamDraft, draftSequence: 0, operation: null as PageTeamOperation | null,
    retryReady: false, recoveryRequired: false, step: 'roster' as 'roster' | 'invite' | 'review' | 'edit_access' | 'review_access', editing: null as PageTeamAssignment | null, accessPermissions: [] as PageTeamPermission[], accessAction: 'edit' as 'edit' | 'revoke', readError: null as string | null, error: null as string | null,
    notice: null as string | null, result: null as PageTeamInvitation | PageTeamAccessChange | null }), [base, pageId, invitationId]);
  const latest = useRef(state); latest.current = state;
  const activeTask = useRef<{ active: boolean; scope: CreatorPageTeamScope } | null>(null);
  const [, render] = useState(0);
  const current = () => mounted.current && latest.current === state && foreground.current && !!base?.isCurrent();
  const scope = useMemo<CreatorPageTeamScope>(() => ({ userId: base?.userId ?? '', isCurrent: current }), [state]);
  const update = () => { if (mounted.current && latest.current === state) render(n => n + 1); };
  const ready = () => current() && state.loaded && !state.readError && !state.busy;
  const beginTask = () => {
    if (activeTask.current) activeTask.current.active = false;
    const task = { active: true, scope: { userId: scope.userId, isCurrent: () => current() && task.active && activeTask.current === task } };
    activeTask.current = task;
    return task;
  };
  const finishTask = (task: NonNullable<typeof activeTask.current>) => {
    task.active = false;
    if (activeTask.current === task) { activeTask.current = null; state.busy = false; update(); }
  };
  const reload = async () => {
    if (!current() || state.busy) return;
    const task = beginTask(), owned = task.scope;
    state.busy = true; state.readError = null; update();
    try {
      await requestWithDeadline((async () => {
        const saved = await readPageTeamState(pageId, owned);
        if (!owned.isCurrent()) return;
        const data = invitationId ? await getPageTeamInvitation(pageId, invitationId, owned) : await getPageTeam(pageId, owned);
        if (!owned.isCurrent()) return;
        // A restored person is a draft choice, not fresh eligibility evidence.
        if (!invitationId && saved.draft.person && !saved.operation) {
          try { saved.draft = { ...saved.draft, person: await getPageTeamRecipient(pageId, saved.draft.person.userId, owned) }; }
          catch { saved.draft = { ...saved.draft, person: null }; }
          if (!owned.isCurrent()) return;
        }
        state.draft = saved.draft; state.operation = saved.operation; state.recoveryRequired = !!saved.operation; state.retryReady = false;
        if (invitationId) state.invitation = data as PageTeamInvitation; else state.roster = data as PageTeamRoster;
        state.loaded = true;
      })(), 12_000);
    } catch { if (owned.isCurrent()) { state.roster = null; state.invitation = null; state.loaded = false; state.readError = 'Couldn’t check this page team. Try again when connected.'; } }
    finally { finishTask(task); }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (activeTask.current) activeTask.current.active = false; }; }, []);
  useEffect(() => { void reload(); }, [state]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', value => {
      foreground.current = value === 'active';
      if (!foreground.current && activeTask.current) {
        activeTask.current.active = false; activeTask.current = null;
        state.busy = false; state.retryReady = false;
        if (state.recoveryRequired) state.error = 'Check the saved action when you return.';
      }
      update(); if (foreground.current) void reload();
    });
    return () => sub.remove();
  }, [state]);
  const persistDraft = (draft: PageTeamDraft) => {
    if (!ready() || state.recoveryRequired) return;
    state.draft = draft; const sequence = ++state.draftSequence; state.error = null; update();
    const owned = { userId: scope.userId, isCurrent: () => current() && state.draftSequence === sequence };
    void requestWithDeadline(savePageTeamDraft(pageId, draft, owned), 12_000).catch(() => {
      if (current() && state.draftSequence === sequence) { state.error = 'Couldn’t keep this draft. Check again before inviting.'; update(); }
    });
  };
  const work = async (action: (owned: CreatorPageTeamScope) => Promise<void>, timeout = 12_000) => {
    if (!ready()) return;
    const task = beginTask();
    state.busy = true; state.error = null; state.notice = null; state.result = null; update();
    try { await requestWithDeadline(action(task.scope), timeout); }
    catch (error) { if (task.scope.isCurrent()) {
      if (!state.recoveryRequired) { state.draft = { ...state.draft, person: null }; if (state.step === 'review') state.step = 'invite'; }
      if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
        state.roster = null; state.invitation = null; state.result = null; state.loaded = false;
        state.readError = 'This page or person is no longer available. Check the page team.';
      }
      state.error = state.result ? 'The outcome is saved. Check again to finish recovery.' : state.recoveryRequired ? 'This action may have saved. Check its status before continuing.' : error instanceof Error ? error.message : 'Couldn’t complete that action. Try again.';
    } }
    finally { finishTask(task); }
  };
  const adoptStored = async (owned: CreatorPageTeamScope) => {
    const saved = await readPageTeamState(pageId, owned);
    if (owned.isCurrent()) { state.operation = saved.operation; state.recoveryRequired = !!saved.operation; state.draft = saved.draft; state.retryReady = false; }
    return saved.operation;
  };
  const complete = async (operation: PageTeamOperation, saved: PageTeamInvitation | PageTeamAccessChange, owned: CreatorPageTeamScope) => {
    if (!owned.isCurrent()) return;
    state.result = saved; state.retryReady = false;
    state.notice = 'action' in saved ? saved.action === 'revoke' ? 'Page access revoked.' : 'Page permissions saved.' : ({ pending: 'Invitation saved. They choose whether to accept.', accepted: saved && 'accessRevokedAt' in saved && saved.accessRevokedAt ? 'This invitation was accepted. Its page access has since been revoked.' : 'Invitation accepted. Check the current permissions for this page.', declined: 'Invitation declined. No access was granted.', canceled: 'Invitation canceled. No access was granted.', expired: 'This invitation has expired.' } as const)[saved.status];
    update();
    // A cleanup failure never changes the confirmed server outcome into failure.
    try { await clearPageTeamOperation(operation, owned); await adoptStored(owned); }
    catch { if (owned.isCurrent()) { state.error = 'The outcome is saved. Check again to finish recovery.'; return; } }
    if (!owned.isCurrent()) return;
    state.step = 'roster'; state.editing = null;
    try {
      const data = invitationId ? await getPageTeamInvitation(pageId, invitationId, owned) : await getPageTeam(pageId, owned);
      if (!owned.isCurrent()) return;
      if (invitationId) state.invitation = data as PageTeamInvitation; else state.roster = data as PageTeamRoster;
    } catch { if (owned.isCurrent()) { state.roster = null; state.invitation = null; state.readError = 'The outcome is saved, but the page could not be refreshed.'; } }
  };
  const dispatch = async (operation: PageTeamOperation, owned: CreatorPageTeamScope) => {
    if (!owned.isCurrent()) return;
    const saved = operation.kind === 'access' ? await changePageTeamAccess(pageId, operation.operationId, operation.assignment, operation.action, operation.permissions, owned) : operation.kind === 'create'
      ? await createPageTeamInvitationWithPermissions(pageId, operation.operationId, operation.recipientId, operation.note, operation.permissions, owned)
      : await resolvePageTeamInvitation(operation.invitation, operation.action, owned);
    if (owned.isCurrent()) await complete(operation, saved, owned);
  };
  const create = () => {
    if (!ready() || !state.roster?.canInvite || state.recoveryRequired || state.step !== 'review' || !state.draft.person || !validPageTeamPermissions(state.draft.permissions, state.roster?.pageKind)) return;
    const draft = state.draft;
    return work(async owned => {
      const person = await getPageTeamRecipient(pageId, draft.person!.userId, owned);
      if (!owned.isCurrent()) return;
      await savePageTeamDraft(pageId, { ...draft, person }, owned);
      if (!owned.isCurrent()) return;
      state.recoveryRequired = true; update();
      const prepared = await preparePageTeamCreation(pageId, person.userId, draft.note, owned, draft.permissions);
      if (!owned.isCurrent()) return;
      state.operation = prepared.operation; state.retryReady = false; update();
      if (prepared.created) await dispatch(prepared.operation, owned);
    }, 25_000);
  };
  const respond = (invitation: PageTeamInvitation, action: PageTeamAction) => {
    if (!ready() || state.recoveryRequired || invitation.pageId !== pageId || (invitationId && invitation.invitationId !== invitationId)) return;
    return work(async owned => {
      state.recoveryRequired = true; update();
      const prepared = await preparePageTeamResponse(invitation, action, owned);
      if (!owned.isCurrent()) return;
      state.operation = prepared.operation; state.retryReady = false; update();
      if (prepared.created) await dispatch(prepared.operation, owned);
    }, 25_000);
  };
  const check = () => {
    if (!ready()) return;
    state.retryReady = false;
    return work(async owned => {
      const operation = await adoptStored(owned);
      if (!operation || !owned.isCurrent()) return;
      if (operation.kind === 'access') {
        const saved = await getPageTeamAccessChange(pageId, operation.operationId, owned);
        if (!owned.isCurrent()) return;
        if (saved) {
          if (saved.assignmentId !== operation.assignment.assignmentId || saved.userId !== operation.assignment.userId || saved.expectedRevision !== operation.assignment.revision || saved.action !== operation.action || JSON.stringify(saved.permissions) !== JSON.stringify(operation.permissions)) throw Error('The saved access change does not match.');
          await complete(operation, saved, owned);
        } else {
          const roster = await getPageTeam(pageId, owned); if (!owned.isCurrent()) return;
          const assignment = roster.assignments.find(a => a.assignmentId === operation.assignment.assignmentId);
          if (!assignment || assignment.revision !== operation.assignment.revision || assignment.revokedAt) {
            await clearPageTeamOperation(operation, owned); await adoptStored(owned);
            if (owned.isCurrent()) { state.roster = roster; state.step = 'roster'; state.editing = null; state.notice = 'Access changed elsewhere. Review the current permissions before making another change.'; }
          } else { state.retryReady = true; state.notice = 'No saved change was found. You can retry the original change.'; }
        }
        return;
      }
      const saved = operation.kind === 'create'
        ? await getPageTeamInvitationAttempt(pageId, operation.operationId, operation.recipientId, owned)
        : await getPageTeamInvitation(pageId, operation.invitation.invitationId, owned);
      if (!owned.isCurrent()) return;
      if (saved && (operation.kind === 'create' || saved.status !== 'pending')) await complete(operation, saved, owned);
      else { state.retryReady = true; state.notice = 'No completed action was found. You can retry the same action.'; }
    });
  };
  return { ...state, account: context.account, ready: ready(),
    refresh: reload, check,
    retry: () => { if (ready() && state.operation && state.retryReady) { const operation = state.operation; state.retryReady = false; return work(owned => dispatch(operation, owned), 25_000); } },
    startInvite: () => { if (ready() && state.roster?.canInvite && !state.recoveryRequired) { state.step = 'invite'; state.error = null; update(); } },
    backToForm: () => { if (ready() && !state.recoveryRequired) { state.step = state.step === 'review' ? 'invite' : state.step === 'review_access' && state.accessAction === 'edit' ? 'edit_access' : 'roster'; update(); } },
    setHandle: (handle: string) => persistDraft({ ...state.draft, handle, person: null }),
    setNote: (note: string) => persistDraft({ ...state.draft, note }),
    togglePermission: (permission: PageTeamPermission) => {
      if (!ready() || state.recoveryRequired) return;
      const list = state.step === 'edit_access' ? state.accessPermissions : state.draft.permissions;
      const next = list.includes(permission) ? list.filter(p => p !== permission) : [...list, permission].sort() as PageTeamPermission[];
      if (!validPageTeamPermissions(next, state.roster?.pageKind, true)) return;
      if (state.step === 'edit_access') { state.accessPermissions = next; update(); } else if (state.step === 'invite') persistDraft({ ...state.draft, permissions: next });
    },
    startAccessChange: (assignment: PageTeamAssignment, action: 'edit' | 'revoke') => {
      if (!ready() || state.recoveryRequired || !state.roster?.canInvite || assignment.revokedAt || !state.roster.assignments.some(a => a.assignmentId === assignment.assignmentId && a.revision === assignment.revision)) return;
      state.editing = assignment; state.accessPermissions = action === 'edit' ? [...assignment.permissions] : []; state.accessAction = action;
      state.step = action === 'edit' ? 'edit_access' : 'review_access'; state.error = null; update();
    },
    reviewAccess: () => { if (ready() && !state.recoveryRequired && state.editing && validPageTeamPermissions(state.accessPermissions, state.roster?.pageKind)) { state.step = 'review_access'; update(); } },
    saveAccess: () => {
      if (!ready() || state.recoveryRequired || !state.roster?.canInvite || state.step !== 'review_access' || !state.editing) return;
      const assignment = state.editing, action = state.accessAction, permissions = [...state.accessPermissions];
      return work(async owned => {
        state.recoveryRequired = true; update();
        const prepared = await preparePageTeamAccess(pageId, assignment, action, permissions, owned);
        if (!owned.isCurrent()) return;
        state.operation = prepared.operation; state.retryReady = false; update();
        if (prepared.created) await dispatch(prepared.operation, owned);
      }, 25_000);
    },
    lookup: () => {
      if (!ready() || !state.roster?.canInvite || state.recoveryRequired || !state.draft.handle.trim()) return;
      const draft = state.draft;
      return work(async owned => { const person = await findPageTeamRecipient(pageId, draft.handle, owned); if (!owned.isCurrent()) return;
        state.draft = { ...draft, person }; await savePageTeamDraft(pageId, state.draft, owned);
        if (!owned.isCurrent()) return;
        if (!person) state.error = 'No eligible account was found. Check their exact handle.';
      });
    },
    review: () => {
      if (!ready() || state.recoveryRequired || !state.draft.person || !validPageTeamPermissions(state.draft.permissions, state.roster?.pageKind)) return;
      const draft = state.draft;
      return work(async owned => { const person = await getPageTeamRecipient(pageId, draft.person!.userId, owned); if (!owned.isCurrent()) return;
        state.draft = { ...draft, person }; await savePageTeamDraft(pageId, state.draft, owned); if (owned.isCurrent()) state.step = 'review';
      });
    }, create, respond,
  };
}
