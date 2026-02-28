# TestFlight Production Checklist

## App Icon (Square)

To update the app icon for the App Store / TestFlight:

1. **Create or export your icon** as a **1024x1024 pixel PNG** (square).
2. **Requirements**:
   - No rounded corners (Apple adds them automatically)
   - No transparency issues — use solid background or proper alpha
   - High contrast, recognizable at small sizes
   - No Apple devices or copyrighted elements
3. **Replace the file**: Save it as `assets/images/app-icon.png` (overwrite this file — `icon.png` is kept for other uses).
4. **Rebuild**: Run `eas build --platform ios` to generate a new build with the updated icon.

**App icon path**: `./assets/images/app-icon.png` (set in app.json)
**Note**: `icon.png` is preserved for the Plans tab and other uses.

---

## Pre-TestFlight Verification

- [x] ErrorBoundary exported from root layout
- [x] Auth flow: login, signup, onboarding, redirect
- [x] Account deletion: RPC + delete-user Edge Function
- [x] Push notifications: token registration, deep-link on tap
- [x] Console.warn only in __DEV__ (usePushNotifications)
- [x] App version: 1.0.0 in app.json
- [x] Bundle ID: com.washedup.app
- [x] ITSAppUsesNonExemptEncryption: false (for faster review)
- [x] EAS project configured (projectId in app.json)

## Build & Submit

```bash
# 1. Install EAS CLI (if needed)
npm install -g eas-cli

# 2. Log in to Expo (if needed)
eas login

# 3. Production iOS build
eas build --platform ios --profile production

# 4. After build completes (~15–20 min), submit to TestFlight
eas submit --platform ios --profile production --latest
```

**First-time setup**: Ensure your Apple Developer account is linked (`eas credentials`). You may need to run `eas build:configure` once.

## Post-Submit

1. App Store Connect → Your App → TestFlight
2. Wait for Apple to process the build (5–30 min)
3. Add internal/external testers
4. Resolve any compliance questions (encryption, etc.)
