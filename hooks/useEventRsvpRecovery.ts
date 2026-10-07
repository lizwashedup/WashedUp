import { useCallback, useEffect, useRef, useState } from 'react';
import { changeRsvpWithRecovery, checkRsvpRecovery, type RsvpOwner, type RsvpRecovery } from '../lib/eventRsvpRecovery';

type Phase = 'loading' | 'ready' | 'working' | 'unknown' | 'error';
export function useEventRsvpRecovery(eventId: string, owner: RsvpOwner | null, onConfirmed: (status: 'going' | 'cancelled') => void, onSettled?: (status: 'going' | 'cancelled' | null) => void) {
  const [state, setState] = useState<{ owner: RsvpOwner | null; eventId: string; phase: Phase; error: string | null }>({ owner: null, eventId, phase: 'loading', error: null });
  const locks = useRef(new Set<RsvpOwner>());
  const confirmed = useRef(onConfirmed); confirmed.current = onConfirmed;
  const settled = useRef(onSettled); settled.current = onSettled;
  const publish = useCallback((phase: Phase, error: string | null = null) => {
    if (owner?.isCurrent()) setState({ owner, eventId, phase, error });
  }, [owner, eventId]);
  const run = useCallback(async (going?: boolean): Promise<boolean> => {
    if (!owner?.isCurrent() || locks.current.has(owner)) return false;
    locks.current.add(owner); publish(going === undefined ? 'loading' : 'working');
    try {
      const result: RsvpRecovery = going === undefined ? await checkRsvpRecovery(eventId, owner) : await changeRsvpWithRecovery(eventId, going, owner);
      if (!owner.isCurrent()) return false;
      publish(result.kind === 'unknown' ? 'unknown' : 'ready');
      if (result.kind === 'confirmed') confirmed.current(result.status);
      if (result.kind === 'settled') settled.current?.(result.status);
      return result.kind === 'confirmed' && (going === undefined || result.status === (going ? 'going' : 'cancelled'));
    } catch (failure) {
      publish('error', failure instanceof Error ? failure.message : 'Your attendance change could not be checked.');
      return false;
    } finally { locks.current.delete(owner); }
  }, [owner, eventId, publish]);
  useEffect(() => { if (owner) void run(); }, [owner, run]);
  const active = state.owner === owner && state.eventId === eventId;
  const phase = active ? state.phase : 'loading';
  return { phase, error: active ? state.error : null, blocked: !!owner && phase !== 'ready',
    busy: !!owner && (phase === 'loading' || phase === 'working'), check: () => run(), change: (going: boolean) => run(going) };
}
