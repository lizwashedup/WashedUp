import { requireLocalBackend } from '../constants/LocalDevelopment';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { createSupabaseFetch } from './supabaseFetch';

// Production packaging: preserved verified public project; current session safeguards retained.
export const SUPABASE_URL = requireLocalBackend(process.env.EXPO_PUBLIC_SUPABASE_URL || "https://upstjumasqblszevlgik.supabase.co");
const supabaseUrl = SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwc3RqdW1hc3FibHN6ZXZsZ2lrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjg4NzYsImV4cCI6MjA4NzgwNDg3Nn0.84inESQAGh_gCfASpy1Xe39NpkWTjilh-jAuV_UM84U";
export { supabaseAnonKey as SUPABASE_ANON_KEY };

// Preserve the existing in-process auth queue and its 25s acquisition budget.
// Concurrent cold-start reads can queue behind a token refresh. The transport
// bounds individual requests (8s, or 9s for tokens); auth-js can make several
// refresh attempts within its own retry budget. These are different clocks:
// a transport deadline does not guarantee immediate lock release. The root
// auth gate separately bounds its visible wait and offers recovery on failure.
const LOCK_ACQUIRE_TIMEOUT_MS = 25000;
const queueTolerantLock: typeof processLock = (name, _acquireTimeout, fn) =>
  processLock(name, LOCK_ACQUIRE_TIMEOUT_MS, fn);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Keep refresh/session changes serialized using the existing RN-safe lock.
    lock: queueTolerantLock,
  },
  global: {
    fetch: createSupabaseFetch(supabaseUrl),
  },
});

// Drive token auto-refresh off app foreground/background. A bare refresh timer
// (autoRefreshToken alone) gets throttled/suspended while RN is backgrounded,
// so a returning user can foreground onto an already-expired token — exactly
// the stale-session path that froze launch. Pausing on background and resuming
// (with an immediate refresh) on foreground keeps the token fresh on return.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
