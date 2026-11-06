import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { INBOX_COUNT_KEY, WAITLIST_MANAGER_KEY } from '../constants/QueryKeys';
import { readWaitlistInvitation, type WaitlistInvitationState } from '../lib/readWaitlistInvitation';
import { hapticLight } from '../lib/haptics';
import { recordScopedPlanAssent, requirePlanParticipationAccount } from '../lib/planParticipationScope';
import { getParticipationNoticeStatus } from '../lib/participationTerms';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { supabase } from '../lib/supabase';
import { acceptWaitlistException, declineWaitlistException, waitlistAlertMessage } from '../lib/waitlistExceptions';

type Scope = { userId: string | null; epoch: number; isCurrent: () => boolean };
type Invitation = { id: string; eventId: string; userId: string };
type Notice = { organizerUserId: string | null; organizerName: string };
type Phase = 'checking' | 'notice' | 'recording' | 'dismissing' | 'joining' | 'declining';
type Reply = Invitation & { phase: Phase; notice?: Notice };
const deadline = 12_000;

export function useInboxWaitlistException(scope: Scope, visit: object, isOpen: () => boolean,
  openChat: (route: string) => void, showError: (message: string) => void) {
  const client = useQueryClient();
  const owner = useMemo(() => ({ reply: null as Reply | null }), [visit, scope.epoch, scope.userId]);
  const declineStates = useMemo(() => new Map<string, Exclude<WaitlistInvitationState, 'invited'>>(),
    [scope.userId, scope.epoch]);
  const writes = useRef(new Set<string>());
  const committed = useRef<typeof owner | null>(null);
  const [, render] = useState(0);
  useLayoutEffect(() => {
    committed.current = owner;
    return () => { committed.current = null; };
  }, [owner]);
  const current = () => committed.current === owner && scope.isCurrent() && isOpen();
  const active = (reply: Reply) => current() && owner.reply === reply;
  const refresh = () => render(value => value + 1);
  const finish = (reply: Reply) => {
    if (active(reply)) { owner.reply = null; refresh(); }
  };

  function invalidate(keys: readonly (readonly unknown[])[]) {
    for (const queryKey of keys) void client.invalidateQueries({ queryKey }).catch(() => {});
  }

  // Membership/decline is decided by the server RPC. Marking the inbox row
  // consumed is a separate operation and cannot undo that decision.
  async function acknowledge(reply: Reply, status: 'acted' | 'read') {
    const list = ['app-notifications', reply.userId, scope.epoch];
    try {
      await requestWithDeadline(supabase.from('app_notifications').update({ status })
        .eq('id', reply.id).eq('event_id', reply.eventId).eq('user_id', reply.userId)
        .eq('type', 'exception_invite').eq('status', 'unread'), deadline);
    } finally {
      invalidate([list, [...INBOX_COUNT_KEY, reply.userId]]);
    }
  }

  async function decide(reply: Reply, alreadyJoined = false) {
    if (!active(reply)) return;
    const declining = reply.phase === 'declining';
    if (!declining) reply.phase = 'joining';
    const key = JSON.stringify([reply.userId, reply.eventId]);
    let locked = false;
    try {
      await requestWithDeadline(requirePlanParticipationAccount({
        viewerId: reply.userId, isCurrent: () => active(reply),
      }), deadline);
      if (!active(reply)) return;
      if (writes.current.has(key)) {
        showError('Your previous reply is still being confirmed. Try again in a moment.');
        return;
      }
      writes.current.add(key);
      locked = true;
      if (declining) {
        try {
          await requestWithDeadline(declineWaitlistException(reply.eventId), deadline);
          declineStates.set(reply.id, 'declined');
        } catch {
          // A missing receipt is not permission to send the same reply again.
          declineStates.set(reply.id, 'unavailable');
          return;
        }
      }
      else if (!alreadyJoined) await requestWithDeadline(acceptWaitlistException(reply.eventId), deadline);
      if (!declining) {
        invalidate([['events', 'members', reply.eventId, reply.userId, scope.epoch],
          ['events', 'detail', reply.eventId, reply.userId, scope.epoch], ['my-plans', reply.userId],
          ['feed-member-ids', reply.userId], ['waitlisted-plans', reply.userId]]);
      }
      if (!active(reply)) return;
      void acknowledge(reply, declining ? 'read' : 'acted').catch(() => {});
      invalidate([WAITLIST_MANAGER_KEY(reply.eventId)]);
      if (!declining) openChat('/(tabs)/chats/' + reply.eventId);
    } catch (error) {
      if (active(reply)) showError(waitlistAlertMessage(error, 'We couldn’t confirm your reply. Open the invitation and try again.'));
    } finally {
      if (locked) writes.current.delete(key);
      if (active(reply)) finish(reply);
      else if (declining && committed.current) refresh();
    }
  }

  async function start(id: string, eventId: string | undefined, decline?: { createdAt: string; checkOnly?: boolean }) {
    if (!eventId || !scope.userId || !current() || owner.reply) return;
    const previous = declineStates.get(id);
    if (previous && (!decline || previous !== 'unavailable')) return;
    if (decline?.checkOnly && previous !== 'unavailable') return;
    const reply: Reply = { id, eventId, userId: scope.userId, phase: decline ? 'declining' : 'checking' };
    owner.reply = reply;
    refresh();
    hapticLight();
    if (decline) {
      let state: WaitlistInvitationState = 'unavailable';
      try { state = await readWaitlistInvitation(reply.userId, eventId, decline.createdAt); }
      catch { /* Keep the invitation available for a read-only retry. */ }
      if (!active(reply)) return;
      if (state !== 'invited') {
        declineStates.set(id, state);
        finish(reply);
        return;
      }
      declineStates.delete(id);
      if (previous === 'unavailable') {
        // Checking restores the choices. Only a new explicit tap decides.
        finish(reply);
        return;
      }
      await decide(reply);
      return;
    }
    try {
      // If the notification is still unread after a successful join, reopening
      // must lead to that chat without resubmitting the invitation.
      const membership = await requestWithDeadline(supabase.from('event_members').select('user_id')
        .eq('event_id', eventId).eq('user_id', reply.userId).eq('status', 'joined').maybeSingle(), deadline);
      if (!active(reply)) return;
      if (membership.error) throw membership.error;
      if (membership.data?.user_id === reply.userId) { await decide(reply, true); return; }
      const { needsAssent } = await requestWithDeadline(getParticipationNoticeStatus(), deadline);
      if (!active(reply)) return;
      if (!needsAssent) { await decide(reply); return; }
      const event = await requestWithDeadline(supabase.from('events').select('creator_user_id').eq('id', eventId).maybeSingle(), deadline);
      if (!active(reply)) return;
      const organizerUserId = event.data?.creator_user_id ?? null;
      const person = organizerUserId ? await requestWithDeadline(supabase.from('profiles_public')
        .select('first_name_display').eq('id', organizerUserId).maybeSingle(), deadline) : null;
      if (!active(reply)) return;
      reply.notice = { organizerUserId, organizerName: person?.data?.first_name_display ?? 'Someone' };
      reply.phase = 'notice';
      refresh();
    } catch {
      if (active(reply)) showError('We couldn’t check your invitation. Please try again.');
      finish(reply);
    }
  }

  const reply = owner.reply;
  const agree = async () => {
    if (!reply?.notice || !active(reply) || reply.phase !== 'notice') return false;
    reply.phase = 'recording';
    let recording = true;
    let recorded = false;
    try {
      recorded = await requestWithDeadline(recordScopedPlanAssent({
        listingType: 'plan', listingId: reply.eventId, ...reply.notice, action: 'join',
      }, { viewerId: reply.userId, isCurrent: () => recording && active(reply) }), deadline);
    } catch { /* Keep the notice open for an explicit retry. */ }
    finally { recording = false; }
    if (!active(reply)) return false;
    if (!recorded) { reply.phase = 'notice'; return false; }
    reply.phase = 'dismissing';
    refresh();
    if (Platform.OS !== 'ios') await decide(reply);
    return true;
  };
  return {
    start,
    pendingId: reply?.id,
    declineState: (id: string) => declineStates.get(id),
    notice: reply && (reply.phase === 'notice' || reply.phase === 'recording') ? reply.notice : undefined,
    agree,
    closeNotice: () => { if (reply?.phase === 'notice') finish(reply); },
    noticeDismissed: () => { if (reply?.phase === 'dismissing' && active(reply)) void decide(reply); },
  };
}
