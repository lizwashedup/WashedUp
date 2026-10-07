import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';

export interface ActiveChatPresenceScope {
  readonly userId: string;
  readonly isCurrent: () => boolean;
}

interface PresenceOwner {
  userId: string;
  eventId: string;
  scope: ActiveChatPresenceScope;
  disposed: boolean;
  appActive: boolean;
  mayBeActive: boolean;
}

// These coordinate only this JS client's existing profile-column writes.
// Different mounted navigation screens can overlap during focus handoff; a
// queue local to one component would not protect the next screen's presence.
const accountQueues = new Map<string, Promise<void>>();
const activeOwners = new Map<string, PresenceOwner>();

function wantsActive(owner: PresenceOwner): boolean {
  return !owner.disposed && owner.appActive && owner.scope.isCurrent() && activeOwners.get(owner.userId) === owner;
}

function schedule(owner: PresenceOwner): void {
  const previous = accountQueues.get(owner.userId) ?? Promise.resolve();
  const work = previous.then(async () => {
    if (!wantsActive(owner) && !owner.mayBeActive) return;
    // Cleanup must be allowed after the viewing scope retires, but must never
    // adopt the next signed-in user. It writes only this captured user's row.
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (user?.id !== owner.userId) return;

    if (wantsActive(owner)) {
      // Even an error response may describe an accepted update whose response
      // was lost. Keep cleanup eligible before dispatch, not only on success.
      owner.mayBeActive = true;
      const { error } = await supabase.from('profiles')
        .update({ active_chat_event_id: owner.eventId }).eq('id', owner.userId);
      if (error) throw error;
      return;
    }
    if (!owner.mayBeActive) return;
    const replacement = activeOwners.get(owner.userId);
    if (replacement && replacement !== owner && replacement.eventId === owner.eventId && wantsActive(replacement)) {
      // A newer visit now owns this same room. A room-ID-only conditional
      // clear cannot distinguish those visits, so leave its presence intact.
      // Transfer responsibility even if its own activation later fails.
      replacement.mayBeActive = true;
      owner.mayBeActive = false;
      return;
    }
    const { error } = await supabase.from('profiles')
      .update({ active_chat_event_id: null })
      .eq('id', owner.userId).eq('active_chat_event_id', owner.eventId);
    if (error) throw error;
    owner.mayBeActive = false;
  }).catch(error => { logError(error, 'useActiveChatPresence'); });
  accountQueues.set(owner.userId, work);
  void work.then(() => { if (accountQueues.get(owner.userId) === work) accountQueues.delete(owner.userId); });
}

/** Existing Plan-only active-chat push suppression. Pass the readable room
 * scope, not the writable composer scope: an expired chat may still be viewed. */
export function useActiveChatPresence(
  eventId: string | undefined,
  scope: ActiveChatPresenceScope | null,
  enabled = true,
): void {
  useFocusEffect(useCallback(() => {
    if (!enabled || !eventId || !scope?.userId || !scope.isCurrent()) return;
    const owner: PresenceOwner = {
      userId: scope.userId, eventId, scope, disposed: false,
      appActive: AppState.currentState === 'active', mayBeActive: false,
    };
    const updateIntent = () => {
      if (owner.appActive && scope.isCurrent()) activeOwners.set(owner.userId, owner);
      else if (activeOwners.get(owner.userId) === owner) activeOwners.delete(owner.userId);
      schedule(owner);
    };
    updateIntent();
    const subscription = AppState.addEventListener('change', state => {
      if (owner.disposed) return;
      owner.appActive = state === 'active';
      updateIntent();
    });
    return () => {
      owner.disposed = true;
      subscription.remove();
      if (activeOwners.get(owner.userId) === owner) activeOwners.delete(owner.userId);
      schedule(owner);
    };
  }, [eventId, scope, enabled]));
}
