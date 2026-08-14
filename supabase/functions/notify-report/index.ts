import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const EXTERNAL_FETCH_TIMEOUT_MS = 10_000;
const ALERT_EMAIL = Deno.env.get('REPORT_ALERT_EMAIL') ?? 'hello@washedup.app';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RUN_TOKEN = Deno.env.get('NOTIFY_REPORT_RUN_TOKEN')!;

interface ReportPayload {
  record: {
    id: string;
    reporter_user_id: string;
    reported_user_id: string;
    reason: string;
    details: string | null;
    reported_event_id: string | null;
    created_at: string;
  };
}

// Constant-time compare so a mistimed response can't leak the service role
// key one byte at a time. Same idiom as ticket-inbox-drain / ticket-payout-release.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// HTML-escape any interpolated value before it lands in the email body. Same
// full 5-entity escape as og-moment's escapeHtml (the reference
// implementation in this codebase), widened to accept unknown so IDs and
// other non-string fields can go through the same helper.
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  // This function is invoked only by the on_report_inserted DB trigger. It
  // had zero auth from 2026-03-07 until the same-day fix that first tried a
  // shared Postgres setting for the service role key -- that setting turned
  // out to be permanently unsettable on this project (Supabase returns
  // 42501 permission denied even from the dashboard SQL editor as the
  // postgres role), so this uses the same dedicated run-token pattern as
  // ticket-inbox-drain / ticket-payout-release instead: a private value only
  // the trigger and this function know, unrelated to the service role key.
  const givenToken = req.headers.get('x-run-token') ?? '';
  if (!RUN_TOKEN || !timingSafeEqual(givenToken, RUN_TOKEN)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload: ReportPayload = await req.json();
    const report = payload.record;

    if (!report?.id) {
      return new Response(JSON.stringify({ error: 'No report data' }), {
        status: 400,
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const [reporterRes, reportedRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('first_name_display, email')
        .eq('id', report.reporter_user_id)
        .single(),
      supabase
        .from('profiles')
        .select('first_name_display, email')
        .eq('id', report.reported_user_id)
        .single(),
    ]);

    const reporterName =
      reporterRes.data?.first_name_display ?? 'Unknown user';
    const reportedName =
      reportedRes.data?.first_name_display ?? 'Unknown user';
    const reportedEmail = reportedRes.data?.email ?? 'N/A';

    const isBlock = report.reason === 'Blocked by user';
    const subject = isBlock
      ? `[WashedUp] User Blocked: ${reportedName}`
      : `[WashedUp] Report: ${reportedName} — ${report.reason}`;

    const planLink = report.reported_event_id
      ? `https://washedup.app/e/${esc(report.reported_event_id)}`
      : 'N/A';

    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #D97746; margin-bottom: 4px;">${isBlock ? 'User Blocked' : 'New Report'}</h2>
        <p style="color: #999; font-size: 13px; margin-top: 0;">${esc(new Date(report.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))} PT</p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
          <tr><td style="padding: 8px 0; color: #666; width: 140px;">Reason</td><td style="padding: 8px 0; font-weight: 600;">${esc(report.reason)}</td></tr>
          ${report.details ? `<tr><td style="padding: 8px 0; color: #666;">Details</td><td style="padding: 8px 0;">${esc(report.details)}</td></tr>` : ''}
          <tr><td style="padding: 8px 0; color: #666;">Reported user</td><td style="padding: 8px 0;">${esc(reportedName)} (${esc(reportedEmail)})</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reported user ID</td><td style="padding: 8px 0; font-family: monospace; font-size: 12px;">${esc(report.reported_user_id)}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reporter</td><td style="padding: 8px 0;">${esc(reporterName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reporter ID</td><td style="padding: 8px 0; font-family: monospace; font-size: 12px;">${esc(report.reporter_user_id)}</td></tr>
          ${report.reported_event_id ? `<tr><td style="padding: 8px 0; color: #666;">Plan</td><td style="padding: 8px 0;"><a href="${planLink}" style="color: #D97746;">${esc(report.reported_event_id)}</a></td></tr>` : ''}
        </table>

        <p style="margin-top: 24px; padding: 12px 16px; background: #FFF3E0; border-radius: 8px; font-size: 14px; color: #333;">
          Apple requires action within <strong>24 hours</strong>: review the content, remove if it violates guidelines, and suspend or ban the offending user.
        </p>
      </div>
    `.trim();

    const res = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'WashedUp Reports <reports@washedup.app>',
        to: [ALERT_EMAIL],
        subject,
        html,
      }),
      timeoutMs: EXTERNAL_FETCH_TIMEOUT_MS,
    });

    if (!res) {
      console.error('[notify-report] Resend timeout or network error');
      return new Response(
        JSON.stringify({ sent: false, error: 'timeout' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const resBody = await res.json();

    return new Response(JSON.stringify({ sent: res.ok, resend: resBody }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
