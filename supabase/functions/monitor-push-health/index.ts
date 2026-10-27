import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetchWithTimeout.ts";
import { handleMonitorRequest } from "./handler.ts";

const runToken = Deno.env.get("MONITOR_PUSH_HEALTH_RUN_TOKEN");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");

// JWT verification stays off for pg_cron; the handler requires a dedicated
// run token before constructing a privileged client or making any RPC.
// Roll out the matching Vault-backed scheduler FIRST (see the runbook).
Deno.serve((req) =>
  handleMonitorRequest(req, {
    runToken,
    configured: Boolean(supabaseUrl && serviceRoleKey && resendApiKey),
    createRpc: () => {
      const client = createClient(supabaseUrl!, serviceRoleKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      return (name, args) => client.rpc(name, args);
    },
    sendAlert: async (subject, html) => {
      const response = await fetchWithTimeout("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "WashedUp Alerts <plans@washedup.app>",
          to: ["liz@washedup.app"],
          subject,
          html,
        }),
      });
      // A network failure may occur after acceptance; do not call it rejection.
      if (!response) throw new Error("alert_acceptance_unknown");
      return response.ok;
    },
  })
);
