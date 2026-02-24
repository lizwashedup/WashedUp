import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://uwjhbfxragjyvylciwrb.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3amhiZnhyYWdqeXZ5bGNpd3JiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyNjA1MzIsImV4cCI6MjA4MzgzNjUzMn0.M3jad-iXCtZAvceAC2x-ZcjKVCa5Yp3I2UGR8myabLU';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
