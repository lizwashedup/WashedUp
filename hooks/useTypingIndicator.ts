import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Ephemeral typing state over a Supabase Realtime Broadcast channel. This is
// deliberately a SEPARATE channel from the chat data channel (chat:${eventId})
// so transient keystroke traffic never touches the postgres_changes pipeline.
// Nothing is persisted: peers expire on their own if a "stopped" event is lost.

const TYPING_BROADCAST_THROTTLE_MS = 3000; // resend "typing" at most this often
const TYPING_IDLE_STOP_MS = 5000; // send "stopped" after this much silence
const TYPING_EXPIRY_MS = 6000; // drop a peer if no refresh within this window
const TYPING_PRUNE_INTERVAL_MS = 1000;

export interface TypingUser {
  userId: string;
  name: string;
}

interface TypingPayload {
  userId?: string;
  name?: string;
  isTyping?: boolean;
}

export function useTypingIndicator(
  eventId: string | undefined,
  currentUserId: string | null,
  currentUserName: string | null,
  // Plan chats keep the original `typing:${id}` channel byte-identical; circle/DM
  // chats use a distinct namespace so the two never cross.
  kind: 'event' | 'circle' = 'event',
) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribedRef = useRef(false);
  const lastSentRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peersRef = useRef<Map<string, { name: string; expiresAt: number }>>(new Map());

  useEffect(() => {
    if (!eventId) return;
    subscribedRef.current = false;

    const flush = () => {
      setTypingUsers(
        Array.from(peersRef.current.entries()).map(([userId, v]) => ({ userId, name: v.name })),
      );
    };

    const channelName = kind === 'event' ? `typing:${eventId}` : `typing:circle:${eventId}`;
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const p = payload as TypingPayload;
      if (!p?.userId || p.userId === currentUserId) return;
      if (p.isTyping) {
        peersRef.current.set(p.userId, {
          name: p.name ?? 'Someone',
          expiresAt: Date.now() + TYPING_EXPIRY_MS,
        });
      } else {
        peersRef.current.delete(p.userId);
      }
      flush();
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') subscribedRef.current = true;
    });
    channelRef.current = channel;

    // Self-healing prune: if a peer's "stopped" event never arrives, their
    // entry expires on its own so the indicator can't get stuck on.
    const pruneTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      peersRef.current.forEach((v, k) => {
        if (v.expiresAt <= now) {
          peersRef.current.delete(k);
          changed = true;
        }
      });
      if (changed) flush();
    }, TYPING_PRUNE_INTERVAL_MS);

    return () => {
      clearInterval(pruneTimer);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
      subscribedRef.current = false;
      lastSentRef.current = 0;
      peersRef.current.clear();
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [eventId, currentUserId, kind]);

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!subscribedRef.current || !currentUserId) return;
      channelRef.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: currentUserId, name: currentUserName ?? 'Someone', isTyping },
      });
    },
    [currentUserId, currentUserName],
  );

  // Call on each keystroke. Throttles the outgoing "typing" to once per
  // TYPING_BROADCAST_THROTTLE_MS and (re)arms an idle timer that sends a
  // "stopped" after TYPING_IDLE_STOP_MS of no further keystrokes.
  const broadcastTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastSentRef.current > TYPING_BROADCAST_THROTTLE_MS) {
      lastSentRef.current = now;
      sendTyping(true);
    }
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      lastSentRef.current = 0;
      sendTyping(false);
    }, TYPING_IDLE_STOP_MS);
  }, [sendTyping]);

  // Immediately announce we stopped (e.g. right after sending a message).
  const stopTyping = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    lastSentRef.current = 0;
    sendTyping(false);
  }, [sendTyping]);

  return { typingUsers, broadcastTyping, stopTyping };
}
