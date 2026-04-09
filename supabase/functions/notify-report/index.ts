import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const ALERT_EMAIL = Deno.env.get('REPORT_ALERT_EMAIL') ?? 'hello@washedup.app';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*' },
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
      ? `https://washedup.app/e/${report.reported_event_id}`
      : 'N/A';

    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #D97746; margin-bottom: 4px;">${isBlock ? 'User Blocked' : 'New Report'}</h2>
        <p style="color: #999; font-size: 13px; margin-top: 0;">${new Date(report.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
          <tr><td style="padding: 8px 0; color: #666; width: 140px;">Reason</td><td style="padding: 8px 0; font-weight: 600;">${report.reason}</td></tr>
          ${report.details ? `<tr><td style="padding: 8px 0; color: #666;">Details</td><td style="padding: 8px 0;">${report.details}</td></tr>` : ''}
          <tr><td style="padding: 8px 0; color: #666;">Reported user</td><td style="padding: 8px 0;">${reportedName} (${reportedEmail})</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reported user ID</td><td style="padding: 8px 0; font-family: monospace; font-size: 12px;">${report.reported_user_id}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reporter</td><td style="padding: 8px 0;">${reporterName}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Reporter ID</td><td style="padding: 8px 0; font-family: monospace; font-size: 12px;">${report.reporter_user_id}</td></tr>
          ${report.reported_event_id ? `<tr><td style="padding: 8px 0; color: #666;">Plan</td><td style="padding: 8px 0;"><a href="${planLink}" style="color: #D97746;">${report.reported_event_id}</a></td></tr>` : ''}
        </table>

        <p style="margin-top: 24px; padding: 12px 16px; background: #FFF3E0; border-radius: 8px; font-size: 14px; color: #333;">
          Apple requires action within <strong>24 hours</strong>: review the content, remove if it violates guidelines, and suspend or ban the offending user.
        </p>
      </div>
    `.trim();

    const res = await fetch('https://api.resend.com/emails', {
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
    });

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
