/**
 * Admin-alert recipient lookup for edge functions.
 *
 * Mirrors the DB-side centralization shipped in migration
 * 20260825110000_centralize_admin_alert_recipient.sql (commit 698769d):
 * the alert address lives in ONE config row
 * (public.admin_alert_recipients, alert_key = 'default') instead of being
 * hardcoded in every function. Changing the recipient is a one-row UPDATE,
 * not a grep across functions.
 *
 * Degrade matches the DB pattern deliberately: a missing row (or a read
 * error) returns null and the caller SKIPS the send — same "absent
 * recipient = skip, never throw" behavior flag_order_for_refund_review /
 * run_signup_watchdog / run_ticket_inbox_watchdog already have. Callers
 * must log the skip so the silence is visible in function logs.
 *
 * RLS: the table grants only service_role, so this must be called with a
 * service-role client (both current callers already hold one).
 */

// Minimal structural type so this works with either supabase-js import
// style used across these functions (esm.sh and npm: specifiers). The
// parameter is typed `unknown` and cast here on purpose: comparing a real
// SupabaseClient generic against a structural interface trips TS2589
// (excessively deep instantiation) under deno check.
interface ServiceClientLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: { email?: string | null } | null; error: { message: string } | null }>;
      };
    };
  };
}

export async function getAdminAlertEmail(
  service: unknown,
  alertKey = 'default',
): Promise<string | null> {
  try {
    const { data, error } = await (service as ServiceClientLike)
      .from('admin_alert_recipients')
      .select('email')
      .eq('alert_key', alertKey)
      .maybeSingle();
    if (error || !data?.email) return null;
    return data.email ?? null;
  } catch {
    return null;
  }
}
