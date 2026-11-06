import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { getPlanLifecycle } from '../lib/planLifecycle';
import { buildDuplicatePostParams } from '../lib/duplicatePlan';
import { hapticLight } from '../lib/haptics';

type Options = {
  eventId: string; enabled: boolean; startTime: string; endTime?: string | null;
  status?: string; onError: () => void;
  viewerId?: string;
  openDraft?: (params: Record<string, string>) => void;
};
const sourceFields = 'id, title, description, start_time, end_time, drop_in, allow_duplicate, location_text, location_lat, location_lng, image_url, primary_vibe, gender_rule, max_invites, target_age_min, target_age_max, tickets_url, neighborhood, explore_event_id, circle_id, status';

/** A duplicate is a read-only draft destination, owned by the initiating card,
 * focused visit and account. Nothing is posted by this hook. */
export function usePlanCardDuplicate(options: Options) {
  const router = useRouter();
  const owner = useMemo(() => ({}), [options.eventId, options.viewerId, options.enabled, options.startTime, options.endTime, options.status]);
  const latest = useRef({ owner, options }); latest.current = { owner, options };
  const visit = useRef<object | null>(null);
  const pending = useRef<object | null>(null);
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    const opened = {}; visit.current = opened; pending.current = null; setBusy(false);
    return () => { if (visit.current === opened) { visit.current = null; pending.current = null; } };
  }, [owner]));

  const open = async () => {
    const opened = visit.current;
    if (!opened || latest.current.owner !== owner || pending.current || !options.enabled ||
      getPlanLifecycle({ status: options.status, startTime: options.startTime, endTime: options.endTime }).isClosed) return;
    const attempt = {}; pending.current = attempt; setBusy(true); hapticLight();
    const current = () => visit.current === opened && latest.current.owner === owner && pending.current === attempt;
    let accountId: string | null | undefined;
    // Observe only while opening a draft; rendering a feed does not create an
    // account request or auth subscription for each visible card.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (accountId !== undefined && accountId !== next && current()) {
        pending.current = null; setBusy(false);
      }
      accountId = next;
    });
    let openedDraft = false;
    try {
      const auth = await requestWithDeadline(supabase.auth.getUser(), 12_000);
      if (!current()) return;
      if (auth.error || !auth.data.user || (options.viewerId && auth.data.user.id !== options.viewerId) || (accountId !== undefined && accountId !== auth.data.user.id)) throw new Error('Account unavailable');
      accountId = auth.data.user.id;
      const { data, error } = await requestWithDeadline(
        supabase.from('events').select(sourceFields).eq('id', options.eventId).single(), 12_000,
      );
      if (!current()) return;
      if (error || !data || data.id !== options.eventId || data.allow_duplicate !== true || data.circle_id !== null ||
        !['forming', 'active', 'full'].includes(data.status) ||
        getPlanLifecycle({ status: data.status, startTime: data.start_time, endTime: data.end_time }).isClosed) {
        throw new Error('Plan is no longer available to copy');
      }
      const params = buildDuplicatePostParams(data, options.eventId);
      if (latest.current.options.openDraft) latest.current.options.openDraft(params);
      else router.push({ pathname: '/(tabs)/post', params });
      openedDraft = true;
    } catch {
      if (current()) latest.current.options.onError();
    } finally {
      subscription.unsubscribe();
      // A successful push stays locked until focus leaves; a queued tap cannot
      // push a second draft while the navigation transition is starting.
      if (current() && !openedDraft) { pending.current = null; setBusy(false); }
    }
  };
  return { open, busy };
}
