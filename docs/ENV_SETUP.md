# Environment Variables Setup

WashedUp reads API keys from environment variables when set. For production, use EAS Secrets and remove keys from `app.json`. **Never commit real keys to the repository.**

## Quick Start (Local Development)

1. Copy the example file:
   ```sh
   cp .env.example .env
   ```

2. Edit `.env` and add your keys:
   - `EXPO_PUBLIC_SUPABASE_URL` — Your Supabase project URL
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` — Your Supabase anon (public) key
   - `GOOGLE_MAPS_API_KEY` — Your Google Maps API key (for app.config.js and GooglePlacesAutocomplete)

3. Restart the dev server after changing `.env`.

## EAS Build (Production)

Use EAS Secrets for production builds:

```sh
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://xxx.supabase.co" --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "your-anon-key" --environment production --visibility plaintext
eas env:create --name GOOGLE_MAPS_API_KEY --value "your-maps-key" --environment production --visibility plaintext
```

Then link the environment in `eas.json`:

```json
{
  "build": {
    "production": {
      "environment": "production"
    }
  }
}
```

## Supabase Auth: Password Reset Redirect

For the password reset flow to work, add this redirect URL in your Supabase project:

1. Supabase Dashboard → Authentication → URL Configuration
2. Add to **Redirect URLs**: `washedupapp://auth/callback`

This allows the reset link in the email to deep-link back into the app.

## Google Cloud Console — Places API Checklist

The key `AIzaSyApjwAgT5x1pw5NgqSvrACmZaKapYuXgCw` (and any replacement) must satisfy all of the following for autocomplete to fire:

| Requirement | Where to check |
|---|---|
| **Places API enabled** | APIs & Services → Library → search "Places API" → must show **Enabled** |
| **Maps SDK for iOS enabled** | APIs & Services → Library → "Maps SDK for iOS" → **Enabled** |
| **Maps SDK for Android enabled** | APIs & Services → Library → "Maps SDK for Android" → **Enabled** |
| **Application restriction** | APIs & Services → Credentials → the key → Application restrictions must be **None** or **iOS/Android apps** with the correct bundle IDs (`com.washedup.app`). **Never** set it to "HTTP referrers" for a mobile app. |
| **Billing account active** | Billing → must be linked and in good standing (Places API requires a billing account even within the free tier) |
| **Quota not exhausted** | APIs & Services → Quotas → check Places API daily quota |

### Key resolution order in the app

`app.config.js` and both `GooglePlacesAutocomplete` usages resolve the key in this order:

1. `GOOGLE_MAPS_API_KEY` — EAS Secret (production builds; server-side only, not exposed at runtime)
2. `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — local `.env` for dev (also available at runtime)
3. Hard-coded fallback `AIzaSyApjwAgT5x1pw5NgqSvrACmZaKapYuXgCw` — keeps CI/preview builds working

For production EAS builds, set **both** secrets so the native SDK config and the runtime autocomplete component each receive the key:

```sh
eas env:create --name GOOGLE_MAPS_API_KEY --value "your-key" --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY --value "your-key" --environment production --visibility plaintext
```

## Security Notes

- The Supabase anon key is designed to be public; security is enforced via Row Level Security (RLS).
- Restrict your Google Maps API key in the Google Cloud Console to **iOS/Android apps** with bundle ID `com.washedup.app` once the app is in production. Do **not** use "HTTP referrers" restriction on a mobile API key.
- `.env` is gitignored — never commit it.
