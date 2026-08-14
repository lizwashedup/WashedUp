// paywall-setup TOMBSTONE: the one-shot provisioner ran on 2026-07-13
// (product + lookup-key prices + webhook endpoint, test mode, idempotency
// proven on a second run) and was retired. The MCP deploy surface has no
// delete, so this 410 responder is the retirement; the setup token died
// with the working version. If provisioning is ever needed again, redeploy
// from supabase/functions/paywall-setup in the repo with a fresh token.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
Deno.serve(()=>new Response('gone', {
    status: 410
  }));
