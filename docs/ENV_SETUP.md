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

## Security Notes

- The Supabase anon key is designed to be public; security is enforced via Row Level Security (RLS).
- Restrict your Google Maps API key in the Google Cloud Console (by app bundle ID / package name).
- `.env` is gitignored — never commit it.
