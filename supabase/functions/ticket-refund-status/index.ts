import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { readRefundRequestStatus, refundRequestIdIsValid } from '../_shared/refundRequestReceipt.ts';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
// Deliberately separate from ticket-refund: older deployments default unknown
// actions to execution. This endpoint has no provider or financial write path.
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json(401, { error: 'unauthenticated' });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'invalid body' }); }
  if (!refundRequestIdIsValid(body?.order_id) || !refundRequestIdIsValid(body?.client_request_id)) return json(400, { error: 'invalid refund request' });
  const caller = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  });
  try {
    const { data, error } = await caller.auth.getUser();
    if (error || !data?.user?.id) return json(401, { error: 'unauthenticated' });
    const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const result = await readRefundRequestStatus(service, { orderId: body.order_id, requestId: body.client_request_id, requesterId: data.user.id });
    return json(result.status, result.body);
  } catch { return json(503, { error: 'refund status could not be checked' }); }
});
