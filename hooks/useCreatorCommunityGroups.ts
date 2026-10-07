import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { ObservedUser } from './useObservedUser';
import { getCommunityRoomIdentities, type CommunityRoomIdentity } from '../lib/communityRoomHistory';
import { canManageCommunityGroups, createCreatorCommunityGroup, getCreatorGroupCreation, normalizeCommunityRoomName, renameCreatorCommunityRoom, type CreatorGroupAttempt, type CreatorGroupReceipt } from '../lib/creatorCommunityGroups';
import { clearCreatorGroupAttempt, prepareCreatorGroupAttempt, readCreatorGroupAttempt } from '../lib/creatorCommunityGroupAttempt';

type Form = { kind: 'create'; draft: string; pending: boolean; retryReady: boolean; attempt?: CreatorGroupAttempt }
  | { kind: 'rename'; draft: string; pending: boolean; retryReady: boolean; room: CommunityRoomIdentity };
/** Creation is durable across reopening. Unknown writes are checked, never replayed on mount. */
export function useCreatorCommunityGroups(communityId: string, viewer: ObservedUser, enabled: boolean) {
  const client = useQueryClient(), mounted = useRef(false), active = useRef(enabled);
  active.current = enabled;
  const foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const owner = useMemo(() => ({ allowed: false, loaded: false, busy: false, form: null as Form | null, error: null as string | null, notice: null as string | null }), [communityId, viewer.viewerId, viewer.epoch]);
  const ref = useRef(owner); ref.current = owner;
  const [, render] = useState(0);
  const same = () => mounted.current && ref.current === owner && viewer.isCurrent();
  const current = () => same() && active.current && foreground.current && !!viewer.viewerId && !viewer.error && !viewer.isLoading;
  const scope = useMemo(() => ({ userId: viewer.viewerId ?? '', isCurrent: current }), [owner, viewer.error, viewer.isLoading]);
  const update = () => { if (same()) render(n => n + 1); };
  const invalidate = () => {
    for (const queryKey of [['community-room-directory'], ['community-chat-rows'], ['community-chat-cards']]) {
      void client.invalidateQueries({ queryKey }).catch(() => {});
    }
  };
  const load = async () => {
    if (!current() || owner.busy) return;
    owner.busy = true; owner.error = null; update();
    try {
      const allowed = await canManageCommunityGroups(communityId, scope);
      if (!current()) return;
      owner.allowed = allowed;
      if (allowed && !owner.form) {
        const attempt = await readCreatorGroupAttempt(communityId, scope);
        if (!current()) return;
        if (attempt) owner.form = { kind: 'create', draft: attempt.name, pending: true, retryReady: false, attempt };
      }
      owner.loaded = true;
    } catch { if (current()) owner.error = 'Couldn’t check creator tools. Try again.'; }
    finally { owner.busy = false; update(); }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (enabled) void load(); }, [enabled, owner, viewer.isLoading, viewer.error]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active'; update();
      if (foreground.current) void load();
    });
    return () => subscription.remove();
  }, [owner, scope]);
  const editable = () => current() && owner.loaded && owner.allowed && !owner.busy;
  const completeCreation = async (receipt: CreatorGroupReceipt) => {
    await clearCreatorGroupAttempt(receipt, scope);
    if (!current()) return;
    owner.form = null;
    owner.notice = receipt.status === 'available' ? `${receipt.currentName} is ready. Open it below.`
      : receipt.status === 'archived' ? 'This saved group has been archived.' : 'This saved group is no longer available.';
    invalidate();
  };
  const write = async (form: Form, retry: boolean) => {
    if (!editable()) return;
    owner.busy = true; owner.error = null; owner.notice = null; update();
    try {
      const name = normalizeCommunityRoomName(form.draft);
      if (form.kind === 'create') {
        // Keep a recoverable state even when local persistence has an uncertain response.
        owner.form = { ...form, draft: name, pending: true, retryReady: false }; update();
        let attempt = form.attempt;
        if (!retry) {
          const prepared = await prepareCreatorGroupAttempt(communityId, name, scope);
          if (!current()) return;
          attempt = prepared.attempt;
          owner.form = { kind: 'create', draft: attempt.name, pending: true, retryReady: false, attempt }; update();
          // Another opening may have submitted the saved request. Check before any replay.
          if (!prepared.created) return;
        }
        if (!attempt || !current()) return;
        const receipt = await createCreatorCommunityGroup(attempt, scope);
        if (current()) await completeCreation(receipt);
      } else {
        owner.form = { ...form, draft: name, pending: true, retryReady: false }; update();
        await renameCreatorCommunityRoom(communityId, form.room, name, scope);
        if (current()) { owner.form = null; owner.notice = 'Chat name saved.'; invalidate(); }
      }
    } catch (error) {
      if (current()) owner.error = owner.form?.pending ? 'Your change may have saved. Check its status.' : error instanceof Error ? error.message : 'Couldn’t save this name.';
    } finally { owner.busy = false; update(); }
  };
  const submit = () => { if (owner.form && !owner.form.pending) return write(owner.form, false); };
  const check = async () => {
    if (!editable() || !owner.form?.pending) return;
    const form = owner.form; owner.busy = true; owner.error = null; update();
    try {
      if (form.kind === 'create') {
        const attempt = form.attempt ?? await readCreatorGroupAttempt(communityId, scope);
        if (!current()) return;
        if (!attempt) { owner.form = { kind: 'create', draft: form.draft, pending: false, retryReady: false }; return; }
        owner.form = { ...form, draft: attempt.name, attempt, retryReady: false };
        const receipt = await getCreatorGroupCreation(communityId, attempt.requestId, scope);
        if (!current()) return;
        if (receipt) {
          if (receipt.name !== attempt.name) throw Error('Saved request does not match.');
          await completeCreation(receipt);
        } else owner.form = { ...form, draft: attempt.name, attempt, retryReady: true };
      } else {
        const layout = await getCommunityRoomIdentities(communityId, scope);
        if (!current()) return;
        if (!layout) throw Error('Chats unavailable.');
        const room = layout.rooms.find(r => r.id === form.room.id && r.role === form.room.role && r.storage === form.room.storage);
        if (!room) { owner.form = null; owner.notice = 'This chat is no longer available.'; invalidate(); }
        else if (room.name === form.draft) { owner.form = null; owner.notice = 'Chat name saved.'; invalidate(); }
        else if (room.name === form.room.name) owner.form = { ...form, retryReady: true };
        else {
          // A newer name is a material conflict. Keep the draft but require a new explicit save.
          owner.form = { ...form, room, pending: false, retryReady: false };
          owner.notice = `This chat is now called ${room.name}. Review your name before saving.`; invalidate();
        }
      }
    } catch { if (current()) { owner.error = 'Couldn’t confirm your change. Check again when connected.'; if (owner.form) owner.form.retryReady = false; } }
    finally { owner.busy = false; update(); }
  };
  return {
    allowed: owner.allowed && owner.loaded && current(), loading: !owner.loaded && owner.busy, busy: owner.busy,
    error: owner.error, notice: owner.notice, form: owner.form, ready: editable(), refresh: load,
    startCreate: () => { if (editable() && !owner.form) { owner.form = { kind: 'create', draft: '', pending: false, retryReady: false }; owner.error = null; owner.notice = null; update(); } },
    startRename: (room: CommunityRoomIdentity) => { if (editable() && !owner.form) { owner.form = { kind: 'rename', room, draft: room.name, pending: false, retryReady: false }; owner.error = null; owner.notice = null; update(); } },
    setDraft: (draft: string) => { if (editable() && owner.form && !owner.form.pending) { owner.form = { ...owner.form, draft }; owner.error = null; update(); } },
    cancel: () => { if (editable() && owner.form && !owner.form.pending) { owner.form = null; owner.error = null; update(); } },
    submit, check, retry: () => { if (owner.form?.pending && owner.form.retryReady) return write(owner.form, true); },
  };
}
