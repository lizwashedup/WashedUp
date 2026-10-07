import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import { normalizeProfileHandle, verifyProfileOwner, isObsoleteProfileOperation, type ProfileOperationScope } from './profileOperations';
type Status = 'idle' | 'unchanged' | 'invalid' | 'checking' | 'available' | 'taken' | 'error';
interface Input { enabled: boolean; handle: string; currentHandle: string | null; scope: ProfileOperationScope; }
export function useProfileHandleAvailability({ enabled, handle, currentHandle, scope }: Input) {
  const clean = normalizeProfileHandle(handle), original = normalizeProfileHandle(currentHandle ?? '');
  const [retryId, setRetryId] = useState(0);
  const [reply, setReply] = useState<{ key: object; status: Status } | null>(null);
  const key = useMemo(() => ({}), [scope.userId, scope.isCurrent, clean, original, enabled, retryId]);
  const latest = useRef({ key, scope }); latest.current = { key, scope };
  const status: Status = !enabled ? 'idle' : clean === original ? 'unchanged' : clean.length < 2 ? 'invalid' : reply?.key === key ? reply.status : 'checking';
  useEffect(() => {
    if (!enabled || clean === original || clean.length < 2) return;
    let active = true;
    const isCurrent = () => active && latest.current.key === key && scope.isCurrent();
    const run = async () => {
      try {
        await verifyProfileOwner({ userId: scope.userId, isCurrent });
        if (!isCurrent()) return;
        const { data, error } = await supabase.from('profiles').select('id').eq('handle', clean).neq('id', scope.userId).maybeSingle();
        if (!isCurrent()) return;
        if (error) throw error;
        setReply({ key, status: data ? 'taken' : 'available' });
      } catch (error) { if (isCurrent() && !isObsoleteProfileOperation(error)) setReply({ key, status: 'error' }); }
    };
    // No stale Available flash during this delay: status derives from the
    // current normalized value, account and retry generation synchronously.
    const timer = setTimeout(() => { void run(); }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [enabled, clean, original, key, scope.userId, scope.isCurrent]);
  const retry = useCallback(() => { if (enabled && latest.current.key === key && scope.isCurrent()) setRetryId(value => value + 1); }, [enabled, key, scope]);
  return { status, handle: clean, canSave: status === 'unchanged' || status === 'available', retry };
}
