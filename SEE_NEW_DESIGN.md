# See the Golden Hour Design (v2)

If the app looks the same as before, follow these steps to load the new design.

## 1. Confirm you're in the right folder

```bash
cd /Users/liz/Downloads/WashedUp-main
pwd   # should show .../WashedUp-main
```

## 2. Pull latest code (if using git)

```bash
git pull origin main
```

## 3. Full cache clear + restart

Stop any running Expo server (Ctrl+C), then:

```bash
rm -rf node_modules/.cache .expo
npx expo start --clear
```

Or use the script:

```bash
npm run start:clean
```

## 4. Open the app

**If you use a development build** (custom app you built with `expo run:ios` or `eas build`):
- Scan the QR code or press `i` for iOS simulator
- The app will load JS from Metro — you should see the new design

**If you use Expo Go**:
- This project has `expo-dev-client` — Expo Go may not work
- To use Expo Go, try: `npx expo start --go`
- Or build a dev client: `npx expo run:ios` (requires Xcode)

## 5. Reload the app

- **iOS Simulator:** Cmd+R
- **Android:** Double-tap R
- **Device:** Shake → Reload

## 6. Verify you're on v2

You should see a small **terracotta "v2" badge** next to the WashedUp logo on the Plans screen. If you see it, the new design is loading.

---

**New design includes:**
- Parchment background (#F8F5F0)
- Terracotta accents (#D97746)
- Cormorant Garamond + DM Sans fonts
- Redesigned Plans feed, Scene tab, Profile, Plan detail
