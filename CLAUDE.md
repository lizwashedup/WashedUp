1. Project Overview

WashedUp is a social utility for real-life meetups. It is a mobile-first app built with React Native and Expo, using Supabase for the backend.

2. Tech Stack & Key Libraries

•
Framework: React Native 0.81.5 with Expo 54

•
Navigation: Expo Router v6 (file-based routing)

•
Backend: Supabase (Auth, Database via RPC, Storage)

•
Data Fetching: TanStack React Query (useQuery)

•
Styling: NativeWind v4 (Tailwind for React Native)

•
UI Components: expo-image, lucide-react-native, react-native-maps

•
Build & Deploy: EAS (Expo Application Services)

3. Architecture & Patterns

•
Data Flow: All primary data (plans, events, user profiles) is fetched from Supabase via Remote Procedure Calls (RPCs), not direct table queries. The main feed uses the get_filtered_feed RPC, which handles all filtering logic server-side.

•
Authentication: Auth state is managed in the root app/_layout.tsx. It uses a supabase.auth.onAuthStateChange listener to handle SIGNED_IN, SIGNED_OUT, and PASSWORD_RECOVERY events, automatically redirecting the user to the correct screen (/login, /plans, or /reset-password).

•
State Management: Server state is managed by React Query. Local UI state is managed with standard React hooks (useState, useContext).

•
Secrets Management: All API keys and secrets (Supabase, Google Maps) are loaded from environment variables via app.config.js and process.env. There must be no hardcoded keys in the source code.

4. Design System: The Golden Hour

All UI must strictly adhere to the design system defined in constants/. Do not use hardcoded hex values or font names.

•
Colors (constants/Colors.ts):

•
terracotta: '#D97746' (Primary CTA)

•
goldenAmber: '#F2A32D' (Secondary accent)

•
parchment: '#F8F5F0' (App background)

•
asphalt: '#1E1E1E' (Primary text)

•
warmGray: '#9B8B7A' (Muted labels)



•
**Typography (constants/Typography.ts):

•
Fonts.display (Cormorant Garamond) for headings and plan titles.

•
Fonts.sans (DM Sans) for all other UI text.



•
Map Style (constants/MapStyle.ts): All MapView components must use the customMapStyle exported from this file.

5. App Store Compliance (DO NOT REMOVE)

The following features are critical for App Store approval and must not be removed or broken:

•
Account Deletion: The full account deletion flow in app/(tabs)/profile.tsx.

•
EULA Agreement: The "By creating an account..." checkbox on the app/(auth)/signup.tsx screen.

•
Privacy Policy Links: The links to the privacy policy, terms, and guidelines in the profile screen.

•
UGC Moderation: The report/block functionality available on user profiles and plans.

•
Privacy Manifest: The privacyManifests configuration in app.json.

•
Permission Strings: All infoPlist permission usage descriptions in app.json.

6. File Structure

•
app/ - All screens and routes.

•
(auth)/ - Login, signup, and onboarding flow.

•
(tabs)/ - The five main tabs: plans, explore (Scene), post, chats, profile.

•
plan/[id].tsx - The Plan Detail screen.

•
event/[id].tsx - The Scene Event Detail screen.

•
reset-password.tsx - The password reset screen.



•
components/plans/PlanCard.tsx - The core person-first plan card component.

•
lib/supabase.ts - The Supabase client configuration.

•
lib/fetchPlans.ts - The main data fetching logic for the plans feed.

•
constants/ - The full design system.

7. Key Commands

•
Start dev server: npx expo start

•
Run on iOS simulator: i

•
Run on Android emulator: a

•
Create production build: eas build --profile production --platform ios

•
Submit to App Store: eas submit --profile production --platform ios
