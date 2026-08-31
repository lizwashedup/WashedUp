// deno-lint-ignore-file no-import-prefix
// add-to-resend-audience: registers the caller (an authenticated user) with
// the WashedUp Resend audience so they get future "plans/events near you"
// emails. Called by app/(auth)/onboarding/basics.tsx after the user submits
// step 1 with marketing_opt_in checked AND an email provided.
//
// Behavior:
//   - 401 if no JWT.
//   - Reads profiles for the caller (service-role client; RLS bypass needed
//     because we trust the JWT-derived auth.uid() but the function may be
//     called before profiles RLS is set up for the row).
//   - Skip-200 if email is null/empty. Explicit opt-out is synchronized as
//     unsubscribed=true so a prior contact is not left in the marketing stream.
//   - PATCH https://api.resend.com/audiences/{AUDIENCE_ID}/contacts/{email} to
//     synchronize an existing contact, falling back to POST only when the
//     provider confirms that contact does not exist.
//   - Logs Resend non-2xx but still returns 200 to the client. Marketing
//     fanout failure shouldn't block the onboarding flow; the column is
//     persisted so a future settings-page sync can pick it up.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// WashedUp main audience. Single audience for now — if we ever add more
// (e.g. region-specific, event-type-specific), promote to env var or pass
// as a request param.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: enqueueErr } = await adminClient.rpc(
      "enqueue_current_profile_audience_sync",
      { p_profile_id: user.id },
    );
    if (enqueueErr) throw enqueueErr;
    return new Response(JSON.stringify({ ok: true, queued: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[add-to-resend-audience] unexpected:", err);
    return new Response(
      JSON.stringify({ error: "audience sync unavailable" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
