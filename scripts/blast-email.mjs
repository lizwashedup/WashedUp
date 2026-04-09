/**
 * WashedUp Blast Email — LAUNCH PARTY
 *
 * Usage:
 *   RESEND_API_KEY=re_xxx node scripts/blast-email.mjs --test
 *   RESEND_API_KEY=re_xxx SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/blast-email.mjs
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

// ─── Plans Data ───────────────────────────────────────────────────────────────

const LAUNCH_PARTY = {
  title: 'WashedUp Launch Party @ QUIRK DTLA',
  date: 'Sunday, March 29 · 5–9PM',
  location: 'Quirk Vintage & Modern, DTLA',
  members: 76,
  image: 'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/event-images/ae8006dc-5bca-42b8-975a-e11ad14b796f/1773950857886.png',
  deepLink: 'washedup://plan/c7acdfab-e775-4b27-b70c-fe503bb71589',
};

const SATURDAY_PLANS = [
  {
    time: '5:00 PM',
    title: 'Wine + Vinyl in Venice',
    location: 'Saba Coffee Shop',
    vibe: 'Music',
    tag: '🎵',
    note: 'Women only',
    creator: 'Nikki',
    creatorPhoto: 'https://uwjhbfxragjyvylciwrb.supabase.co/storage/v1/object/public/profile-photos/59cffb0f-70d2-43bd-96b0-4d46a4ef0e1a/1769970809759.jpg',
    link: 'https://washedup.app/e/537aedc9-ae02-49b8-a750-431930ce3a37',
    linkLabel: 'View Plan',
    id: '537aedc9-ae02-49b8-a750-431930ce3a37',
  },
  {
    time: '5:00 PM',
    title: '4-Year Anniversary Party at Benny Boy Brewing Co',
    location: 'Downtown Los Angeles',
    vibe: 'Nightlife',
    tag: '🍺',
    creator: 'Christian',
    creatorPhoto: 'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/profile-photos/116a2537-754b-469d-b808-633ab98ce36e/1774629877064.jpg',
    link: 'https://washedup.app/e/25dd9d78-f257-41c0-85ca-742c9de51f9d',
    linkLabel: 'View Plan',
    id: '25dd9d78-f257-41c0-85ca-742c9de51f9d',
  },
  {
    time: '6:30 PM',
    title: 'The Maine at The Novo',
    location: 'The Novo, DTLA',
    vibe: 'Music',
    tag: '🎵',
    creator: 'Bridget',
    creatorPhoto: 'https://uwjhbfxragjyvylciwrb.supabase.co/storage/v1/object/public/profile-photos/18c0b741-1a45-4ffe-a587-1ba027c3db9c/1769813219897.jpg',
    link: 'https://washedup.app/e/ce1e27f5-b085-4670-9535-b8133d9c3d2b',
    linkLabel: 'View Plan',
    id: 'ce1e27f5-b085-4670-9535-b8133d9c3d2b',
  },
  {
    time: '8:00 PM',
    title: 'Electric Feels ⚡',
    location: 'Echo Plex',
    vibe: 'Nightlife',
    tag: '🎉',
    creator: 'Gio',
    creatorPhoto: 'https://uwjhbfxragjyvylciwrb.supabase.co/storage/v1/object/public/profile-photos/8c66b14e-74e6-4c1c-bc6c-6b0a3792dd1c/1771360488938.jpg',
    link: 'https://washedup.app/e/d71d682b-22b6-43ce-a866-1033faacc868',
    linkLabel: 'View Plan',
    id: 'd71d682b-22b6-43ce-a866-1033faacc868',
  },
  {
    time: '8:00 PM',
    title: '"Three Coconuts" Performance (Free!)',
    location: '1130 Lincoln Blvd, Santa Monica',
    vibe: 'Theater',
    tag: '🎭',
    creator: 'Sean',
    creatorPhoto: 'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/profile-photos/6c88c86b-4d86-4e1e-8cbd-f5657974a927/1774335221781.jpg',
    link: 'https://washedup.app/e/67224b87-431d-4315-88b3-d905e9a34c7a',
    linkLabel: 'View Plan',
    id: '67224b87-431d-4315-88b3-d905e9a34c7a',
  },
  {
    time: '11:00 PM',
    title: 'Shimza @ Sound nightclub',
    location: '1642 N Las Palmas Ave, Hollywood',
    vibe: 'Nightlife',
    tag: '🎉',
    creator: 'Kazim Raza',
    creatorPhoto: 'https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/profile-photos/5433edab-3bac-49c2-b1a2-8e2025c09825/1774511970477.jpg',
    link: 'https://washedup.app/e/d9e7d15a-e10e-4118-a76b-9884a3799e76',
    linkLabel: 'View Plan',
    id: 'd9e7d15a-e10e-4118-a76b-9884a3799e76',
  },
];

// ─── Email HTML ───────────────────────────────────────────────────────────────

function buildPlanCard(plan) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px; background:#ffffff; border-radius:12px; border:1px solid #E8E3DC; overflow:hidden;">
      <tr>
        <td style="padding:16px 18px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <!-- Vibe tag + time -->
            <tr>
              <td>
                <span style="font-family:Arial,sans-serif; font-size:11px; color:#D97746; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">${plan.tag} ${plan.vibe}${plan.note ? ' · ' + plan.note : ''}</span>
              </td>
              <td align="right">
                <span style="font-family:Arial,sans-serif; font-size:13px; color:#666666; font-weight:600;">${plan.time}</span>
              </td>
            </tr>
            <!-- Title -->
            <tr>
              <td colspan="2" style="padding-top:6px;">
                <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-size:17px; font-weight:700; color:#1E1E1E; line-height:1.3;">${plan.title}</p>
              </td>
            </tr>
            <!-- Location -->
            <tr>
              <td colspan="2" style="padding-top:4px;">
                <p style="margin:0; font-family:Arial,sans-serif; font-size:13px; color:#666666;">📍 ${plan.location}</p>
              </td>
            </tr>
            <!-- Creator + Link -->
            <tr>
              <td style="padding-top:12px;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <img src="${plan.creatorPhoto}" width="28" height="28" alt="${plan.creator}" style="display:block; width:28px; height:28px; border-radius:50%; object-fit:cover; border:2px solid #E8E3DC;" />
                    </td>
                    <td style="vertical-align:middle; padding-left:8px;">
                      <span style="font-family:Arial,sans-serif; font-size:13px; color:#1E1E1E; font-weight:600;">${plan.creator}</span>
                      <span style="font-family:Arial,sans-serif; font-size:12px; color:#999999;"> is posting</span>
                    </td>
                  </tr>
                </table>
              </td>
              <td align="right" style="padding-top:12px; vertical-align:middle;">
                <a href="${plan.link}" style="display:inline-block; background:#F0EBE3; color:#D97746; font-family:Arial,sans-serif; font-size:12px; font-weight:700; text-decoration:none; padding:7px 14px; border-radius:8px;">${plan.linkLabel} →</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function buildHtml() {
  const planCards = SATURDAY_PLANS.map(buildPlanCard).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LAUNCH PARTY</title>
</head>
<body style="margin:0; padding:0; background-color:#F8F5F0; font-family:Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8F5F0;">
  <tr>
    <td align="center" style="padding:32px 16px 48px;">

      <!-- Container -->
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

        <!-- Header -->
        <tr>
          <td align="center" style="padding-bottom:20px;">
            <img src="https://upstjumasqblszevlgik.supabase.co/storage/v1/object/public/event-images/brand/washedup-logo.png" alt="WashedUp" width="200" style="display:block; width:200px; height:auto;" />
          </td>
        </tr>

        <!-- Apology banner -->
        <tr>
          <td style="background:#F0EBE3; border-radius:10px; padding:14px 18px; margin-bottom:20px;">
            <p style="margin:0; font-family:Arial,sans-serif; font-size:13px; color:#666666; line-height:1.5;">Whoops — sorry about that! Our links in the last email were broken. Here are the correct ones. 🧡</p>
          </td>
        </tr>

        <!-- Spacer -->
        <tr><td style="height:20px;"></td></tr>

        <!-- Hero card: Launch Party -->
        <tr>
          <td style="background:#1E1E1E; border-radius:16px; overflow:hidden; padding:0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <!-- Party image -->
              <tr>
                <td style="padding:0;">
                  <img src="${LAUNCH_PARTY.image}" alt="WashedUp Launch Party" width="580" style="display:block; width:100%; max-width:580px; height:auto; border-radius:16px 16px 0 0;" />
                </td>
              </tr>
              <!-- Party info -->
              <tr>
                <td style="padding:24px 28px 28px;">
                  <!-- Members badge -->
                  <table cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                    <tr>
                      <td style="background:#D97746; border-radius:20px; padding:5px 14px;">
                        <span style="font-family:Arial,sans-serif; font-size:12px; font-weight:700; color:#ffffff; letter-spacing:0.3px;">🧡 ${LAUNCH_PARTY.members} people going</span>
                      </td>
                    </tr>
                  </table>
                  <!-- Title -->
                  <p style="margin:0 0 8px; font-family:Georgia,'Times New Roman',serif; font-size:26px; font-weight:700; color:#ffffff; line-height:1.2;">${LAUNCH_PARTY.title}</p>
                  <!-- Date + Location -->
                  <p style="margin:0 0 6px; font-family:Arial,sans-serif; font-size:14px; color:#F8F5F0; opacity:0.85;">${LAUNCH_PARTY.date}</p>
                  <p style="margin:0 0 24px; font-family:Arial,sans-serif; font-size:14px; color:#F8F5F0; opacity:0.75;">📍 ${LAUNCH_PARTY.location}</p>
                  <!-- CTA Button -->
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="background:#D97746; border-radius:10px; padding:14px 32px;">
                        <a href="https://apps.apple.com/app/washedup-meet-people-in-la/id6759820053" style="font-family:Arial,sans-serif; font-size:15px; font-weight:700; color:#ffffff; text-decoration:none; letter-spacing:0.3px;">Open WashedUp → RSVP</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:32px 0 20px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-top:2px solid #E8E3DC;"></td>
              </tr>
            </table>
            <p style="margin:16px 0 0; font-family:Georgia,'Times New Roman',serif; font-size:20px; font-weight:700; color:#1E1E1E;">Plans happening tomorrow night →</p>
            <p style="margin:6px 0 0; font-family:Arial,sans-serif; font-size:14px; color:#666666;">Saturday, March 28 · Find your people in LA</p>
          </td>
        </tr>

        <!-- Plan cards -->
        <tr>
          <td>
            ${planCards}
          </td>
        </tr>

        <!-- CTA Banner -->
        <tr>
          <td style="background:#D97746; border-radius:12px; padding:20px 24px; margin-top:8px; text-align:center;">
            <p style="margin:0 0 4px; font-family:Georgia,'Times New Roman',serif; font-size:18px; font-weight:700; color:#ffffff;">Open the app to join a plan</p>
            <p style="margin:0 0 16px; font-family:Arial,sans-serif; font-size:13px; color:#ffffff; opacity:0.85;">All plans are live on WashedUp right now.</p>
            <a href="https://apps.apple.com/app/washedup-meet-people-in-la/id6759820053" style="display:inline-block; background:#ffffff; color:#D97746; font-family:Arial,sans-serif; font-size:14px; font-weight:700; text-decoration:none; padding:11px 28px; border-radius:8px;">Download WashedUp</a>
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
      subject: 'LAUNCH PARTY (corrected links!)',
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
      subject: 'LAUNCH PARTY (corrected links!)',
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
