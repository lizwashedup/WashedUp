import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Use env vars for production; fallback for local dev. Set via .env or EAS Secrets.
const DEFAULT_SUPABASE_URL = 'https://upstjumasqblszevlgik.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwc3RqdW1hc3FibHN6ZXZsZ2lrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjg4NzYsImV4cCI6MjA4NzgwNDg3Nn0.84inESQAGh_gCfASpy1Xe39NpkWTjilh-jAuV_UM84U';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
const supabaseUrl = SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
