import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { withDeadline } from '../lib/withTimeout';
import { markWelcomeShown } from '../lib/promptState';

type Account = { id: string | null; unavailable: boolean };

function recordWelcome(id: string) {
  void AsyncStorage.setItem('has_seen_welcome_' + id, '1').catch(() => {});
  void Promise.resolve(supabase.from('profiles').update({ welcome_seen_at: new Date().toISOString() }).eq('id', id)).catch(() => {});
}

/** A welcome-banner lookup must never hold the signed-in person's feed closed. */
export function usePlansEntry() {
  const [account, setAccount] = useState<Account>({ id: null, unavailable: false });
  const current = useRef(account);
  const mounted = useRef(false);
  const retryRead = useRef<(() => void) | undefined>(undefined);
  const [checked, setChecked] = useState<Account>();
  const [welcome, setWelcome] = useState<Account>();

  useEffect(() => {
    let active = true;
    mounted.current = true;
    let revision = 0;
    const publish = (id: string | null, unavailable = !id) => {
      if (current.current.id === id && current.current.unavailable === unavailable) return;
      const next = { id, unavailable };
      current.current = next;
      setAccount(next);
    };
    async function read() {
      const own = ++revision;
      publish(null, false);
      try {
        const result = await withDeadline(supabase.auth.getSession(), 6000, 'Plans account');
        if (active && revision === own) publish(result.data.session?.user.id ?? null);
      } catch {
        if (active && revision === own) publish(null);
      }
    }
    const start = revision;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      ++revision;
      publish(session?.user.id ?? null);
    });
    retryRead.current = read;
    if (start === revision) void read();
    return () => { active = false; mounted.current = false; retryRead.current = undefined; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const id = account.id;
    if (!id) return;
    let active = true;
    const owns = () => active && current.current === account;
    const key = 'has_seen_welcome_' + id;
    const check = async () => {
      const cached = await withDeadline(AsyncStorage.getItem(key), 4000, 'Welcome preference');
      if (cached || !owns()) return;
      const [name, seen] = await withDeadline(Promise.all([
        supabase.from('profiles').select('first_name_display').eq('id', id).maybeSingle(),
        supabase.from('profiles').select('welcome_seen_at').eq('id', id).maybeSingle(),
      ]), 4000, 'Welcome profile');
      if (!owns()) return;
      if (seen.error) throw seen.error;
      if (!seen.data?.welcome_seen_at) {
        if (!name.data?.first_name_display) return;
        setWelcome(account);
        markWelcomeShown();
        // Dispatch for this account only. Neither receipt is needed by the feed.
        recordWelcome(id);
      } else {
        void AsyncStorage.setItem(key, '1').catch(() => {});
      }
    };
    void check().then(() => { if (owns()) setChecked(account); }, () => {
      // On an unknown preference, skip optional prompts for this visit.
    });
    return () => { active = false; };
  }, [account]);

  const isCurrentAccount = useCallback(() => mounted.current && current.current === account, [account]);
  const retry = useCallback(() => { if (current.current.unavailable) retryRead.current?.(); }, []);
  const dismissWelcome = useCallback(() => {
    if (!mounted.current || current.current !== account || !account.id) return;
    setWelcome(undefined);
    recordWelcome(account.id);
  }, [account]);
  return { userId: account.id, isCurrentAccount, accountUnavailable: account.unavailable, retry, showWelcome: welcome === account,
    dismissWelcome, welcomeChecked: checked === account };
}
