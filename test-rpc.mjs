#!/usr/bin/env node
/**
 * Test get_filtered_feed RPC (Ghost Protocol)
 * Run: node test-rpc.mjs
 * Optional: SUPABASE_SERVICE_ROLE_KEY in env to get real user from auth.users
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://upstjumasqblszevlgik.supabase.co';
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwc3RqdW1hc3FibHN6ZXZsZ2lrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjg4NzYsImV4cCI6MjA4NzgwNDg3Nn0.84inESQAGh_gCfASpy1Xe39NpkWTjilh-jAuV_UM84U';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

async function getFirstUserId() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1, sortOrder: 'asc' });
    if (!error && data?.users?.[0]?.id) {
      return data.users[0].id;
    }
  }
  const { data: profiles } = await supabase.from('profiles').select('id').order('created_at', { ascending: true }).limit(1);
  return profiles?.[0]?.id ?? null;
}

async function main() {
  let userId = await getFirstUserId();
  if (!userId) {
    userId = '00000000-0000-0000-0000-000000000001';
    console.log('No user found (set SUPABASE_SERVICE_ROLE_KEY for auth.users). Using placeholder to test RPC.');
  } else {
    console.log('Using user ID:', userId);
  }

  // Call get_filtered_feed RPC
  const { data, error } = await supabase.rpc('get_filtered_feed', {
    p_user_id: userId,
  });

  if (error) {
    console.error('RPC FAILED:', error.message);
    process.exit(1);
  }

  const rows = Array.isArray(data) ? data : [];
  console.log('RPC SUCCEEDED. Rows returned:', rows.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
