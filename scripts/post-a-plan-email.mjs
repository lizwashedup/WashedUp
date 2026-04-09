/**
 * WashedUp Blast Email — POST A PLAN (1,000 users milestone)
 *
 * Usage:
 *   RESEND_API_KEY=re_xxx node scripts/post-a-plan-email.mjs --test
 *   RESEND_API_KEY=re_xxx SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/post-a-plan-email.mjs
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = 'https://upstjumasqblszevlgik.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isTest = process.argv.includes('--test');

if (!RESEND_API_KEY) {
  console.error('❌ Missing RESEND_API_KEY env var');
  process.exit(1);
}

if (!isTest && !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY env var (required for full blast)');
  process.exit(1);
}

// ─── Email HTML ───────────────────────────────────────────────────────────────

function buildHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Something you want to do? Create a Plan.</title>
</head>
<body style="margin:0; padding:0; background-color:#F8F5F0; font-family:Arial,sans-serif;">

<!-- Preheader (hidden) -->
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">WashedUp just hit 1,000 users in LA — more company for everything.</div>

<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8F5F0;">
  <tr>
    <td align="center" style="padding:32px 16px 48px;">

      <!-- Container -->
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

        <!-- Logo -->
        <tr>
          <td align="center" style="padding-bottom:28px;">
            <img src="https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/event-images/brand/washedup-logo.png" alt="WashedUp" width="200" style="display:block; width:200px; height:auto;" />
          </td>
        </tr>

        <!-- Hero card -->
        <tr>
          <td style="background:#ffffff; border-radius:16px; border:1px solid #E8E3DC; padding:32px 32px 36px;">

            <!-- Greeting -->
            <p style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:28px; font-weight:700; color:#1E1E1E; line-height:1.2;">Happy Tuesday, everyone! 🧡</p>

            <!-- Milestone copy -->
            <p style="margin:0 0 12px; font-family:Arial,sans-serif; font-size:15px; color:#1E1E1E; line-height:1.6;">We have some very exciting news — <strong>WashedUp has officially hit over 1,000 users all across LA.</strong> That means more company for the things everyone wants to do.</p>

            <p style="margin:0 0 24px; font-family:Arial,sans-serif; font-size:15px; color:#1E1E1E; line-height:1.6;">Post something you want to do with people. Anything — getting ice cream, a hike, a comedy show, a concert, a random Tuesday night out. If it'd be nicer with company, post it.</p>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#D97746; border-radius:10px; padding:14px 32px;">
                  <a href="https://washedup.app/app/create" style="font-family:Arial,sans-serif; font-size:15px; font-weight:700; color:#ffffff; text-decoration:none; letter-spacing:0.3px;">Post a Plan →</a>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Spacer -->
        <tr><td style="height:24px;"></td></tr>

        <!-- Did you know? card -->
        <tr>
          <td style="background:#F0EBE3; border-radius:16px; padding:24px 28px;">

            <p style="margin:0 0 8px; font-family:Arial,sans-serif; font-size:11px; font-weight:700; color:#D97746; text-transform:uppercase; letter-spacing:1px;">💡 Did you know?</p>

            <p style="margin:0 0 10px; font-family:Georgia,'Times New Roman',serif; font-size:18px; font-weight:700; color:#1E1E1E; line-height:1.3;">You control who sees your plan.</p>

            <p style="margin:0; font-family:Arial,sans-serif; font-size:14px; color:#666666; line-height:1.6;">On WashedUp, you can set your plan to <strong style="color:#1E1E1E;">Women Only</strong> or <strong style="color:#1E1E1E;">Men Only</strong> — and only that group will be able to see and join it. Everything on your feed stays relevant to you.</p>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding-top:32px; text-align:center;">
            <p style="margin:0 0 4px; font-family:Arial,sans-serif; font-size:12px; color:#999999;">WashedUp · Los Angeles</p>
            <p style="margin:0; font-family:Arial,sans-serif; font-size:12px; color:#999999;">
              Questions? <a href="mailto:hello@washedup.app" style="color:#D97746; text-decoration:none;">hello@washedup.app</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}

// ─── Send ─────────────────────────────────────────────────────────────────────

const SUBJECT = 'Something you want to do? Create a Plan.';

async function getRecipients() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?onboarding_status=eq.complete&email=not.is.null&select=email,first_name_display`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sendTest() {
  const html = buildHtml();
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'WashedUp <hello@washedup.app>',
      to: ['liz@washedup.app'],
      subject: SUBJECT,
      html,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(body)}`);
  console.log('✅ Test email sent to liz@washedup.app', body);
}

async function sendBlast() {
  const recipients = await getRecipients();
  console.log(`📬 Sending to ${recipients.length} users...`);

  const html = buildHtml();

  // Resend batch allows up to 100 emails per call — chunk if needed
  const CHUNK = 100;
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const chunk = recipients.slice(i, i + CHUNK);
    const batch = chunk.map(({ email }) => ({
      from: 'WashedUp <hello@washedup.app>',
      to: [email],
      subject: SUBJECT,
      html,
    }));

    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Resend batch error: ${JSON.stringify(body)}`);
    console.log(`✅ Sent batch ${Math.floor(i / CHUNK) + 1} (${chunk.length} emails)`, body?.data?.length ?? body);
  }

  console.log(`🎉 Done! ${recipients.length} emails sent.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (isTest) {
  sendTest().catch((e) => { console.error(e); process.exit(1); });
} else {
  sendBlast().catch((e) => { console.error(e); process.exit(1); });
}
