// Shared pieces for the contributor-community paywall edge functions
// (docs 31/32, Liz's call-a resolution 2026-07-12: paying IS the door,
// no approval step; the founding grant is the silent free door).
//
// THE ONE RULE: these functions gate entry to ONE community, the washedup
// contributor community (reserved handles below). Nothing here may touch
// any other community's flow.
import { createClient } from 'npm:@supabase/supabase-js@2';
// the reserved house handles, mirroring lib/houseCommunity.ts and the
// batch-28 S2 trigger. the real community occupies exactly one of the two.
export const HOUSE_COMMUNITY_HANDLES = [
  'washedup',
  'contributors'
];
// stripe subscription statuses that count as "in" (proposal 32 call e):
// past_due rides Stripe's own dunning window.
export const CURRENT_SUB_STATUSES = [
  'active',
  'trialing',
  'past_due'
];
// TEST MODE ONLY until Liz's explicit live go: every function that talks
// to Stripe checks the key class first, so a live key sitting in env can
// never be exercised by this code. Remove on the live flip, deliberately.
export function stripeKeyIsTest(key) {
  return key.startsWith('sk_test_') || key.startsWith('rk_test_');
}
export function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: {
      persistSession: false
    }
  });
}
export async function getHouseCommunity(admin) {
  const { data, error } = await admin.from('communities').select('id, handle, name').in('handle', HOUSE_COMMUNITY_HANDLES).limit(1).maybeSingle();
  if (error) throw new Error(`house community lookup failed: ${error.message}`);
  return data;
}
// the member's second key: live founding grant OR current subscription.
// mirror of public.is_contributor_member, evaluated under service_role.
export async function hasContributorKey(admin, userId) {
  const [grant, sub] = await Promise.all([
    admin.from('contributor_founding_grants').select('user_id').eq('user_id', userId).is('revoked_at', null).limit(1).maybeSingle(),
    admin.from('contributor_subscriptions').select('id').eq('user_id', userId).in('status', CURRENT_SUB_STATUSES).limit(1).maybeSingle()
  ]);
  if (grant.error) throw new Error(`grant lookup failed: ${grant.error.message}`);
  if (sub.error) throw new Error(`subscription lookup failed: ${sub.error.message}`);
  return Boolean(grant.data) || Boolean(sub.data);
}
export async function getHouseMemberRow(admin, communityId, userId) {
  const { data, error } = await admin.from('community_members').select('id, role, status, joined_at').eq('community_id', communityId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`member lookup failed: ${error.message}`);
  return data;
}
export function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
