import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../lib/supabase';

export function useSessionLogger(userId: string | null) {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (!userId) return;

    const logSession = async () => {
      try {
        const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
        await supabase
          .from('user_sessions')
          .upsert(
            { user_id: userId, session_date: today },
            { onConflict: 'user_id,session_date' }
          );
      } catch {
        // fail silently — never surface errors to the user
      }
    };

    // Log immediately on cold start
    logSession();

    // Log again each time the app returns from background
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current !== 'active' && next === 'active') {
        logSession();
      }
      appState.current = next;
    });

    return () => sub.remove();
  }, [userId]);
}
