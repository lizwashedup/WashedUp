# Share Link Previews (Open Graph)

When users share a plan or event link (e.g. `https://washedup.app/e/abc123`) to Facebook, Slack, Instagram, etc., the preview shows the **plan/event photo**, title, and description.

## How It Works (Lovable)

- **/e/:code** — Short code route handled client-side via React Router (ShortCodeRedirect component)
- **og-event Edge Function** — Lovable's Edge Function generates dynamic OG metadata for social crawlers
- **Fallback image** — `/images/og-image-v2.png` when no plan/event photo

Social crawlers don't execute the SPA, so they hit the Edge Function for dynamic meta tags.

## Testing

- **Facebook**: [Sharing Debugger](https://developers.facebook.com/tools/debug/)
- **Twitter**: [Card Validator](https://cards-dev.twitter.com/validator)
- **LinkedIn**: Paste the URL when creating a post — it fetches the preview
