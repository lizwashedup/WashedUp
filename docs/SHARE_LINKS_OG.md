# Share Link Previews (Open Graph)

When users share a plan or event link (e.g. `https://washedup.app/e/abc123`) to Facebook, Slack, Instagram, iMessage, etc., the preview shows the **plan/event photo** (or placeholder), **plan title**, and description.

## How It Works

1. **Share URLs** — `https://washedup.app/e/{planId}` (used in PlanCard, SharePlanModal, plan detail, etc.)
2. **Vercel rewrite** — `vercel.json` rewrites `/e/:code` to the Supabase Edge Function
3. **og-event Edge Function** — Fetches plan data from `events` table and returns HTML with:
   - `og:title` — plan title
   - `og:image` — plan image (or fallback placeholder)
   - `og:description` — date, location, description snippet
4. **Deep link** — Meta refresh redirects to `washedupapp://plan/{id}` so users open in the app

Social crawlers don't execute the SPA, so they hit the Edge Function for dynamic meta tags.

## Deployment

1. **Deploy the Edge Function:**
   ```bash
   supabase functions deploy og-event
   ```

2. **Hosting** — If using Vercel, `vercel.json` is already configured. For other hosts (Netlify, etc.), add a similar rewrite:
   - `/e/:code` → `https://uwjhbfxragjyvylciwrb.supabase.co/functions/v1/og-event?code=:code`

3. **Placeholder image** — Ensure `https://washedup.app/assets/images/plan-placeholder.png` is publicly accessible (e.g. from your static export).

## Testing

- **Facebook**: [Sharing Debugger](https://developers.facebook.com/tools/debug/)
- **Twitter**: [Card Validator](https://cards-dev.twitter.com/validator)
- **LinkedIn**: Paste the URL when creating a post — it fetches the preview
