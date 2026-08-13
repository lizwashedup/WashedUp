-- Office scaffold Phase 3: seed tools + tool_updates with the real 29
-- services (7 categories) already hardcoded in washedup-world's own
-- systems/page.tsx CATEGORIES const (in-code comment says "25 real
-- services", stale -- the array itself has 29, all seeded here, none
-- invented, none dropped). cost_display preserves the exact free-text
-- string the UI renders today ("~$12", "?", "Free"); cost holds a
-- best-effort parsed number (0 for free/included, NULL only where no
-- number exists at all). Category-level accent dot colors are NOT stored
-- here -- same precedent as finance/page.tsx's CATEGORY_COLORS map, a
-- small hardcoded lookup in the page component, not office data.

BEGIN;

INSERT INTO tools (name, category, cost, cost_display, billing, url, favicon_domain, bg_color, description, long_description, note, active) VALUES
-- Runs the app
('Supabase', 'Runs the app', 25, '$25', 'monthly', 'https://supabase.com/dashboard', 'supabase.com', '#3ECF8E', 'Database & backend', 'The entire backend. Postgres database, auth, edge functions, realtime subscriptions, and file storage. Every API call the app makes goes through here.', NULL, true),
('Vercel', 'Runs the app', 20, '$20', 'monthly', 'https://vercel.com/dashboard', 'vercel.com', '#000000', 'Web hosting', 'Hosts washedup.app. Handles deployments, preview URLs for PRs, edge network, and analytics. Pushes to main auto-deploy.', NULL, true),
('Resend', 'Runs the app', 20, '$20', 'monthly', 'https://resend.com', 'resend.com', '#000000', 'Email delivery', 'Sends all transactional emails like plan invites, password resets, receipts, and notifications. Uses the washedup.app domain for sending.', NULL, true),
('Expo / EAS', 'Runs the app', 29, '$29', 'monthly', 'https://expo.dev', 'expo.dev', '#000020', 'Mobile builds', 'Builds and ships the React Native app. EAS Build compiles iOS/Android binaries, EAS Update pushes over-the-air JS updates without app store review.', NULL, true),
('Twilio', 'Runs the app', 12, '~$12', 'monthly', 'https://console.twilio.com', 'twilio.com', '#F22F46', 'Auth & SMS', 'Handles SMS-based authentication and phone number verification. The new auth system currently being built.', NULL, true),
('Stripe', 'Runs the app', 0, 'Free', 'usage', 'https://dashboard.stripe.com', 'stripe.com', '#635BFF', 'Payments', 'Processes all payments. Charges 2.9% + 30¢ per transaction. No monthly fee, only charges when revenue comes in.', NULL, true),
('Cloudflare', 'Runs the app', 0, 'Free', 'free', 'https://dash.cloudflare.com', 'cloudflare.com', '#F6821F', 'DNS & security', 'Manages DNS records, provides CDN caching, DDoS protection, and SSL certificates for all WashedUp domains.', NULL, true),
('Apple Developer', 'Runs the app', 99, '$99', 'yearly', 'https://developer.apple.com', 'developer.apple.com', '#000000', 'App Store', 'Required to publish and maintain the iOS app on the App Store. Annual membership includes access to beta tools and TestFlight.', NULL, true),
('Google Play', 'Runs the app', 25, '$25', 'one-time', 'https://play.google.com/console', 'play.google.com', '#34A853', 'Play Store', 'One-time registration fee to publish Android apps on the Google Play Store. Already paid.', NULL, true),
('App Store Connect', 'Runs the app', 0, 'Free', 'free', 'https://appstoreconnect.apple.com', 'appstoreconnect.apple.com', '#147EFB', 'iOS app management', 'Where the iOS app is managed. Upload builds, run TestFlight beta testing, manage the App Store listing, respond to reviews, and view app analytics. Comes with the Apple Developer membership.', NULL, true),
-- Watching & measuring
('Sentry', 'Watching & measuring', 0, 'Free', 'free', 'https://washedup.sentry.io', 'sentry.io', '#362347', 'Error monitoring', 'Catches errors in production across web and mobile. Includes tracing, session replay, and AI-powered issue analysis. Currently on free trial.', 'Trial', true),
('Firebase', 'Watching & measuring', 0, 'Free', 'free', 'https://console.firebase.google.com', 'firebase.google.com', '#FFCA28', 'App platform', 'Google''s app platform. Provides crash reporting, performance monitoring, and analytics for the mobile app. Recently connected to the project.', NULL, true),
('OneSignal', 'Watching & measuring', 0, 'Free', 'free', 'https://onesignal.com', 'onesignal.com', '#E54448', 'Push notifications', 'Push notification service with delivery analytics and engagement dashboards. Replacing Expo''s basic push system for better visibility into notification performance.', 'Migrating', true),
('Google Analytics', 'Watching & measuring', 0, 'Free', 'free', 'https://analytics.google.com', 'analytics.google.com', '#E37300', 'Website traffic', 'Tracks visitor behavior on washedup.app. Page views, user flows, referral sources, and conversion events.', NULL, true),
('Search Console', 'Watching & measuring', 0, 'Free', 'free', 'https://search.google.com/search-console', 'search.google.com', '#458CF5', 'SEO & indexing', 'Shows how WashedUp appears in Google search. Impressions, clicks, average position, and any indexing issues.', NULL, true),
-- Running the business
('Google Workspace', 'Running the business', 14, '$14', 'monthly', 'https://admin.google.com', 'google.com', '#4285F4', 'Email & docs', 'Everything @washedup.app. Gmail, Google Drive, Calendar, Meet. The main business communication and file storage hub.', NULL, true),
('DocSend', 'Running the business', 10, '$10', 'monthly', 'https://docsend.com', 'docsend.com', '#00B4D8', 'Investor decks', 'Hosts and tracks investor pitch decks. Shows who viewed each page, how long they spent, and whether they forwarded it.', NULL, true),
-- Building & talking
('Claude', 'Building & talking', 200, '$200', 'monthly', 'https://claude.ai', 'claude.ai', '#D97746', 'AI assistant', 'Anthropic''s AI. Used for coding, operations, content writing, and basically running half the company. The biggest monthly expense and worth every penny.', NULL, true),
('Anthropic Console', 'Building & talking', 0, 'Included', 'free', 'https://console.anthropic.com', 'console.anthropic.com', '#191919', 'API & usage', 'API keys, usage tracking, billing, and model access. Where the blog agents and all API-powered tools get their keys.', NULL, true),
('GitHub', 'Building & talking', 0, 'Free', 'free', 'https://github.com', 'github.com', '#24292E', 'Code & CI/CD', 'All WashedUp code lives here. Washedup-web, washedup-main (mobile), and other repos. Handles pull requests, code review, and automated checks.', NULL, true),
('Slack', 'Building & talking', 0, 'Free', 'free', 'https://washedup-app.slack.com', 'slack.com', '#4A154B', 'Team chat', 'Internal communication between Liz and Tyler. Channels for general, content, dev, and alerts.', NULL, true),
-- Creative
('Canva', 'Creative', 13, '$13', 'monthly', 'https://canva.com', 'canva.com', '#00C4CC', 'Design & graphics', 'Social media graphics, brand assets, and marketing materials. Team name is "Funky Sol." Tyler has admin access.', NULL, true),
('Linktree', 'Creative', NULL, '?', 'unknown', 'https://linktr.ee', 'linktr.ee', '#43E660', 'Bio link page', 'The link-in-bio page for WashedUp social profiles. Directs followers to the app, website, and other links.', NULL, true),
-- Socials
('Instagram', 'Socials', 0, 'Free', 'free', 'https://instagram.com', 'instagram.com', '#E4405F', 'Social media', 'WashedUp''s Instagram presence. Posts, stories, reels. Main social channel for community engagement.', NULL, true),
('TikTok', 'Socials', 0, 'Free', 'free', 'https://tiktok.com', 'tiktok.com', '#000000', 'Short-form video', 'WashedUp on TikTok. Short-form video content for discovery and brand awareness.', NULL, true),
('Facebook', 'Socials', 0, 'Free', 'free', 'https://facebook.com', 'facebook.com', '#1877F2', 'Social media', 'WashedUp''s Facebook page for broader audience reach and community.', NULL, true),
('LinkedIn', 'Socials', 0, 'Free', 'free', 'https://linkedin.com', 'linkedin.com', '#0A66C2', 'Professional network', 'WashedUp''s LinkedIn company page. Exists but not actively posted on yet.', NULL, true),
-- Domains (bgColor was #D97746 in the static page, an arbitrary reuse for
-- WashedUp's own domains, not an external brand -- corrected to #B5522E here)
('washedup.app', 'Domains', 18, '~$18', 'yearly', 'https://washedup.app', 'washedup.app', '#B5522E', 'Primary domain', 'The main domain where the website and web app live. Registered through Cloudflare.', NULL, true),
('washedup.com', 'Domains', 18, '~$18', 'yearly', 'https://washedup.com', 'washedup.com', '#B5522E', 'Redirect domain', 'Redirects to washedup.app. Kept to prevent someone else from registering it.', NULL, true);

INSERT INTO tool_updates (tool_id, note_date, text)
SELECT id, '2026-04-01', 'Set up on web (production) and mobile (pending next build). 5 repos connected. Hooked up to Firebase.' FROM tools WHERE name = 'Sentry';

INSERT INTO tool_updates (tool_id, note_date, text)
SELECT id, '2026-04-01', 'Just hooked up. Connected to Sentry for error monitoring.' FROM tools WHERE name = 'Firebase';

INSERT INTO tool_updates (tool_id, note_date, text)
SELECT id, '2026-04-01', 'Migration from Expo push planned. Phased coexistence approach: run both in parallel, then cut over.' FROM tools WHERE name = 'OneSignal';

COMMIT;
