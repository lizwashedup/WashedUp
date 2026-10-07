// Local/review only: requires migration 2090 and complete integration checks.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createEventMediaVerificationHandler } from '../_shared/eventMediaVerificationHandler.ts';
const url = Deno.env.get('SUPABASE_URL') ?? '', anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '', service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const client = (key: string, signal: AbortSignal, authorization?: string) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { ...(authorization ? { headers: { Authorization: authorization } } : {}),
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }) },
});
const handler = createEventMediaVerificationHandler({ supabaseUrl: url, anonKey: anon,
  userClient: (authorization, signal) => client(anon, signal, authorization), verifierClient: signal => client(service, signal) });
Deno.serve(request => !url || !anon || !service ? new Response('verification unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } }) : handler(request));
