# WashedUp Webapp — Complete Design System Reference

> **Audience**: This document is written for an AI coding assistant (Claude) building a Next.js webapp. Every value is exact — do not approximate, round, or substitute. If a hex color, font size, or spacing value is specified here, use it verbatim. This design system is translated 1:1 from the production React Native mobile app.

---

## 1. CSS Variables (REQUIRED — paste into globals.css)

Every color and size in the app must come from these variables. No hardcoded hex values anywhere in component code. Reference these variables exclusively.

```css
:root {
  /* ── Primary palette ─────────────────────────────────── */
  --terracotta: #D97746;       /* THE brand color. Used for: all primary buttons, all CTA buttons, active states, links, focus rings, loading spinners */
  --golden-amber: #F2A32D;    /* Secondary accent. Used for: "1 left" badges, highlight pills, urgency indicators */
  --parchment: #F8F5F0;       /* THE page background. Every page, every screen. Not white — it's a warm off-white. */
  --asphalt: #1E1E1E;         /* Primary text color. All headings, all body text, all important labels. */
  --white: #FFFFFF;            /* Button text on colored backgrounds, card surfaces */

  /* ── Supporting text colors ────────────────────────────── */
  --text-medium: #666666;      /* Secondary text: creator notes, descriptions, secondary labels */
  --text-light: #999999;       /* Tertiary text: placeholders, meta info (dates, locations), inactive states */
  --warm-gray: #9B8B7A;        /* Muted UI: completed badges, secondary icons, disabled states */

  /* ── Surfaces & borders ────────────────────────────────── */
  --border: #E8E3DC;           /* ALL borders and dividers. Warm-tinted, not cold gray. */
  --card-bg: #FFFFFF;          /* Card backgrounds. Cards sit on top of --parchment. */
  --input-bg: #F0EBE3;         /* Input field backgrounds. Warm beige, not gray. */

  /* ── Semantic ────────────────────────────────────────── */
  --success-green: #4CAF50;    /* Success states, confirmations */
  --error-red: #E53935;        /* Error text, error borders, destructive actions, filled hearts (wishlisted) */
  --error-bg-light: #FEE2E2;  /* Light red background for error banners/alerts */
  --cancel-red: #DC2626;       /* Cancel/remove buttons */

  /* ── Empty states ────────────────────────────────────── */
  --empty-icon-bg: #FFF0E8;   /* Background circle behind empty-state icons */

  /* ── Overlays ────────────────────────────────────────── */
  --overlay-dark: rgba(0,0,0,0.5);        /* Modal backdrops */
  --overlay-medium: rgba(0,0,0,0.45);     /* Image overlays for text readability */
  --overlay-warm: rgba(217,119,70,0.18);  /* Subtle terracotta tint overlays */

  /* ── Category accent colors (used for vibe/category tags) ── */
  --cat-music: #7C5CBF;
  --cat-film: #5C7CBF;
  --cat-nightlife: #BF5C7C;
  --cat-food: #BF7C5C;
  --cat-outdoors: #5CBF7C;
  --cat-fitness: #5CBFBF;
  --cat-art: #BF5CBF;
  --cat-comedy: #D97746;
  --cat-sports: #5C7CBF;
  --cat-wellness: #5CBF9C;

  /* ── Typography ──────────────────────────────────────── */
  --font-display: 'Cormorant Garamond', serif;   /* Editorial/display font */
  --font-sans: 'DM Sans', sans-serif;            /* UI/body font */

  /* Font sizes with their exact line-heights */
  --text-display-xl: 38px;   --lh-display-xl: 44px;
  --text-display-lg: 28px;   --lh-display-lg: 34px;
  --text-display-md: 22px;   --lh-display-md: 28px;
  --text-display-sm: 18px;   --lh-display-sm: 24px;
  --text-body-lg: 16px;      --lh-body-lg: 24px;
  --text-body-md: 14px;      --lh-body-md: 20px;
  --text-body-sm: 13px;      --lh-body-sm: 18px;
  --text-caption: 11px;      --lh-caption: 16px;
  --text-micro: 10px;        --lh-micro: 14px;

  /* ── Spacing & Radii ─────────────────────────────────── */
  --radius-card: 16px;       /* All cards */
  --radius-button: 14px;     /* All buttons */
  --radius-input: 12px;      /* All input fields */
  --radius-pill: 20px;       /* Badge pills, tags */
  --radius-avatar: 9999px;   /* Circular avatars */
}
```

### Global body styles

```css
body {
  background-color: var(--parchment);
  color: var(--asphalt);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 24px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}

a {
  color: var(--terracotta);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
```

---

## 2. Google Fonts Setup (Next.js)

Use `next/font/google` for optimal loading. This is the exact configuration:

```tsx
import { Cormorant_Garamond, DM_Sans } from 'next/font/google';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-sans',
  display: 'swap',
});

// In your root layout, apply both to <html>:
// <html className={`${cormorant.variable} ${dmSans.variable}`}>
```

### Exact font usage map

This table tells you exactly which font, weight, and size to use for every type of text in the app. There are no exceptions.

| Text type | font-family | font-weight | font-size | line-height | color | Example |
|---|---|---|---|---|---|---|
| Page hero title | var(--font-display) | 700 | 38px | 44px | var(--asphalt) | "Find People to Do Things With" |
| Section heading | var(--font-display) | 700 | 28px | 34px | var(--asphalt) | "Plans Near You" |
| Plan card title | var(--font-display) | 700 | 22px | 28px | var(--asphalt) | "Sunset Hike at Griffith" |
| Plan card creator note | var(--font-display) | 400 italic | 14px | 20px | var(--text-medium) | "Bringing snacks and good vibes" |
| Button text | var(--font-sans) | 500 | 14px | 20px | var(--white) or var(--terracotta) | "Let's Go" |
| Nav links / labels | var(--font-sans) | 500 | 14px | 20px | var(--asphalt) | "Privacy", "Terms" |
| Body paragraph | var(--font-sans) | 400 | 16px | 24px | var(--asphalt) | Policy text, descriptions |
| Secondary body text | var(--font-sans) | 400 | 14px | 20px | var(--text-medium) | Subtitles, helper text |
| Meta text (date, location) | var(--font-sans) | 400 | 13px | 18px | var(--text-light) | "Wed, Mar 5 · 7:00 PM" |
| Creator name on card | var(--font-sans) | 500 | 14px | 20px | var(--asphalt) | "Posted by Sarah" |
| "First plan" subtitle | var(--font-sans) | 400 | 13px | 18px | var(--text-medium) | "First plan" |
| Badge text | var(--font-sans) | 500 | 11px | 16px | var(--white) | "1 left" |
| Spots count | var(--font-sans) | 400 | 13px | 18px | var(--text-medium) | "3 of 8" |
| Caption / fine print | var(--font-sans) | 400 | 11px | 16px | var(--text-light) | Legal footnotes |
| Input text | var(--font-sans) | 400 | 16px | 24px | var(--asphalt) | User-typed text |
| Input placeholder | var(--font-sans) | 400 | 16px | 24px | var(--text-light) | "Enter your email" |
| Error message | var(--font-sans) | 500 | 13px | 18px | var(--error-red) | "Please enter a valid email" |

---

## 3. Component Specifications

### 3.1 Plan Card

This is the most important component. It must look identical to the mobile app. Here is the exact structure and reference CSS:

```html
<article class="plan-card">
  <!-- Row 1: Creator info + actions -->
  <div class="plan-card__creator-row">
    <div class="plan-card__creator-left">
      <img class="plan-card__avatar" src="..." alt="Sarah" />
      <!-- OR if no photo: -->
      <!-- <div class="plan-card__avatar-placeholder"><svg>person icon</svg></div> -->
      <div class="plan-card__creator-details">
        <span class="plan-card__creator-name">Posted by Sarah</span>
        <span class="plan-card__creator-sub">First plan</span>
      </div>
    </div>
    <div class="plan-card__actions">
      <!-- "1 left" badge only shows when exactly 1 spot remains -->
      <span class="plan-card__badge-urgent">1 left</span>
      <button class="plan-card__icon-btn" aria-label="Save plan">
        <!-- Heart icon, 18px. Outlined when not saved, filled red when saved. -->
      </button>
      <button class="plan-card__icon-btn" aria-label="Share plan">
        <!-- Share/arrow icon, 18px -->
      </button>
    </div>
  </div>

  <!-- Row 2: Plan title -->
  <h3 class="plan-card__title">Sunset Hike at Griffith Park</h3>

  <!-- Row 3: Creator's note (only if provided, wrapped in quotes) -->
  <p class="plan-card__note">"Bringing snacks and good vibes. Meet at the trailhead."</p>

  <!-- Row 4: Logistics -->
  <div class="plan-card__logistics">
    <div class="plan-card__logistics-line">
      <svg><!-- calendar icon 14px --></svg>
      <span>Wed, Mar 5 · 7:00 PM</span>
    </div>
    <div class="plan-card__logistics-line">
      <svg><!-- location pin icon 14px --></svg>
      <span>Griffith Observatory, Los Angeles</span>
    </div>
  </div>

  <!-- Row 5: Bottom row with count + CTA -->
  <div class="plan-card__bottom">
    <span class="plan-card__spots">3 of 8</span>
    <button class="plan-card__cta">Let's Go &rarr;</button>
  </div>
</article>
```

```css
.plan-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
}

.plan-card__creator-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.plan-card__creator-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.plan-card__avatar {
  width: 48px;
  height: 48px;
  border-radius: 9999px;
  object-fit: cover;
  flex-shrink: 0;
}

.plan-card__avatar-placeholder {
  width: 48px;
  height: 48px;
  border-radius: 9999px;
  background: var(--white);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.plan-card__avatar-placeholder svg {
  width: 24px;
  height: 24px;
  color: var(--text-light);
}

.plan-card__creator-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.plan-card__creator-name {
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 14px;
  line-height: 20px;
  color: var(--asphalt);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plan-card__creator-sub {
  font-family: var(--font-sans);
  font-weight: 400;
  font-size: 13px;
  line-height: 18px;
  color: var(--text-medium);
}

.plan-card__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.plan-card__badge-urgent {
  background: var(--golden-amber);
  color: var(--white);
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 11px;
  line-height: 16px;
  padding: 4px 8px;
  border-radius: 20px;
}

.plan-card__icon-btn {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--asphalt);
  display: flex;
  align-items: center;
  justify-content: center;
}
.plan-card__icon-btn svg {
  width: 18px;
  height: 18px;
}

.plan-card__title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 22px;
  line-height: 28px;
  color: var(--asphalt);
  margin: 0 0 8px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.plan-card__note {
  font-family: var(--font-display);
  font-weight: 400;
  font-style: italic;
  font-size: 14px;
  line-height: 20px;
  color: var(--text-medium);
  margin: 0 0 8px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.plan-card__logistics {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.plan-card__logistics-line {
  display: flex;
  align-items: center;
  gap: 6px;
}
.plan-card__logistics-line svg {
  width: 14px;
  height: 14px;
  color: var(--text-light);
  flex-shrink: 0;
}
.plan-card__logistics-line span {
  font-family: var(--font-sans);
  font-weight: 400;
  font-size: 13px;
  line-height: 18px;
  color: var(--text-light);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plan-card__bottom {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plan-card__spots {
  font-family: var(--font-sans);
  font-weight: 400;
  font-size: 13px;
  line-height: 18px;
  color: var(--text-medium);
}

.plan-card__cta {
  margin-left: auto;
  background: var(--terracotta);
  color: var(--white);
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 14px;
  line-height: 20px;
  padding: 10px 16px;
  border: none;
  border-radius: 14px;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.plan-card__cta:hover {
  opacity: 0.9;
}

/* Joined state */
.plan-card__cta--joined {
  background: var(--terracotta);
}

/* Waitlist state (event is full, user not joined) */
.plan-card__cta--waitlist {
  background: transparent;
  border: 1.5px solid var(--terracotta);
  color: var(--terracotta);
}

/* Past/completed state */
.plan-card--past {
  opacity: 0.7;
}

.plan-card__completed-badge {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: var(--input-bg);
  border-radius: 14px;
}
.plan-card__completed-badge svg {
  width: 14px;
  height: 14px;
  color: var(--warm-gray);
}
.plan-card__completed-badge span {
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 13px;
  line-height: 18px;
  color: var(--warm-gray);
}
```

#### Plan Card behavior notes

- **Title** is always max 2 lines, truncated with ellipsis
- **Creator note** is always wrapped in double quotes: `"Like this"`. Max 2 lines, truncated.
- **Creator note** only renders if the creator provided a message. If null/empty, skip it entirely — do not render an empty element.
- **"1 left" badge** only appears when exactly 1 spot remains (capacity minus member count equals 1). It does not appear for 2 left, 3 left, etc.
- **Spots text** format: `"[count] of [capacity]"` (e.g. "3 of 8"). When full: `"[count] of [capacity] · Full"`.
- **Capacity** is calculated as: `min(max_invites + 1, 8)`. The +1 is because the creator counts as a member. Max group size is always 8.
- **Member count** is capped at 8. Never display a number higher than 8.
- **Date format**: `"Wed, Mar 5 · 7:00 PM"` — short weekday, short month, day, centered dot, time with AM/PM.
- **Location**: Only display if `location_text` exists and does not start with "http". Otherwise hide the location line entirely.
- **CTA states**: "Let's Go →" (default), "Going ✓" (user is a member), "Waitlist →" (event full, user not joined)
- **Past events**: Card has 0.7 opacity. CTA is replaced with a "Completed" badge (checkmark icon + "Completed" text on an --input-bg background).
- **The card itself is clickable** (links to the plan detail). On hover, subtle opacity change (0.92).
- **Icons**: Use Lucide icons or any clean line-icon set. The mobile app uses `lucide-react-native` and `Ionicons`. Recommended web equivalent: `lucide-react`.

---

### 3.2 Buttons

Four button types. Every button in the app must be one of these:

```css
.btn {
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 14px;
  line-height: 20px;
  padding: 10px 16px;
  border-radius: 14px;
  cursor: pointer;
  transition: opacity 0.15s ease;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.btn:hover { opacity: 0.9; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Primary — terracotta bg, white text */
.btn--primary {
  background: var(--terracotta);
  color: var(--white);
}

/* Outline — transparent bg, terracotta border + text */
.btn--outline {
  background: transparent;
  color: var(--terracotta);
  border: 1.5px solid var(--terracotta);
}

/* Destructive — red bg, white text */
.btn--destructive {
  background: var(--error-red);
  color: var(--white);
}

/* Ghost — no bg, medium text */
.btn--ghost {
  background: transparent;
  color: var(--text-medium);
}
.btn--ghost:hover {
  color: var(--asphalt);
}
```

---

### 3.3 Input Fields

```css
.input {
  font-family: var(--font-sans);
  font-weight: 400;
  font-size: 16px;
  line-height: 24px;
  color: var(--asphalt);
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
  width: 100%;
  outline: none;
  transition: border-color 0.15s ease;
}
.input::placeholder {
  color: var(--text-light);
}
.input:focus {
  border-color: var(--terracotta);
}
.input--error {
  border-color: var(--error-red);
}
```

---

### 3.4 Category/Vibe Tags

Used to show what type of activity a plan is (music, food, outdoors, etc.):

```css
.vibe-tag {
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 11px;
  line-height: 16px;
  padding: 4px 10px;
  border-radius: 20px;
  color: var(--white);
  display: inline-block;
}
/* Apply the appropriate category color as background:
   music → var(--cat-music), film → var(--cat-film), etc. */
```

Category name mapping (database `primary_vibe` value → display label):
- `music` → "Music"
- `film` → "Film"
- `nightlife` → "Nightlife"
- `food` → "Food & Drink"
- `outdoors` → "Outdoors"
- `fitness` → "Fitness"
- `art` → "Art"
- `comedy` → "Comedy"
- `sports` → "Sports"
- `wellness` → "Wellness"

---

## 4. Page-by-Page Requirements

### 4.1 Landing Page (`/`)

The main marketing page. Should feel warm, inviting, and casual.

**Layout:**
- Full-width hero section with parchment background
- App name "WashedUp" in Cormorant Garamond Bold, large (38px+)
- Tagline: "Find people to do things with" or "Meet People in LA" in DM Sans Regular
- App Store and Google Play download buttons/badges
- Optionally: 2-3 phone mockup screenshots of the app
- Brief "How it works" section (3 steps: Browse plans → Join a group → Go do the thing)
- Footer with links to /privacy, /terms, /guidelines, /support

**Design notes:**
- Background: var(--parchment) for the whole page
- Cards or sections: var(--card-bg) with var(--border) border and 16px radius
- CTA buttons: var(--terracotta) primary style
- Do NOT make it look like a generic SaaS landing page. It should feel like a warm invitation, not a product pitch.

---

### 4.2 Privacy Policy (`/privacy`)

**Required for both App Store and Play Store.**

**Content must cover:**
- What data is collected: email address, first name, date of birth (for age verification — users must be 18+), gender, profile photo, precise location (when granted), messages sent in group chats, push notification tokens, device identifiers
- How data is stored: Supabase (hosted on AWS, US servers), encrypted in transit via HTTPS
- How data is used: Solely for app functionality (showing nearby plans, group chats, age/gender filtering). Data is never sold to third parties. No advertising tracking.
- Third-party services: Supabase (database/auth), Expo (push notifications), Apple Sign-In, Google Sign-In
- Data retention: Data is kept while account is active. Upon account deletion, all personal data (profile, messages, event history, photos) is permanently deleted within 48 hours.
- User rights: Users can request data export or deletion by emailing hello@washedup.app or using the in-app account deletion feature
- Children: The app is not intended for users under 18.
- Contact: hello@washedup.app

**Layout:** Standard legal page. Use var(--font-sans) for body, var(--font-display) Bold for the page title. Keep it readable with proper heading hierarchy (h1, h2, h3).

---

### 4.3 Terms of Service (`/terms`)

**Required — accepted by users during signup in the mobile app.**

**Content must cover:**
- Eligibility: Users must be 18 years or older
- Account responsibility: Users are responsible for their account credentials
- User-generated content: Users retain ownership but grant WashedUp a license to display their content within the app. WashedUp may remove content that violates guidelines.
- Prohibited conduct: No harassment, hate speech, discrimination, spam, scams, illegal activity, impersonation, explicit/sexual content
- Meetups/events: WashedUp facilitates connections but is not responsible for what happens at in-person events. Users attend at their own risk.
- Termination: WashedUp may suspend or terminate accounts that violate these terms
- Limitation of liability: Standard limitation language
- Governing law: State of California
- Contact: hello@washedup.app

---

### 4.4 Community Guidelines (`/guidelines`)

**Required — accepted by users during signup.**

**Tone: firm but warm.** Not legalese — write it like you're talking to a friend.

**Must include:**
- Be respectful and kind
- No harassment, bullying, or threats
- No hate speech or discrimination based on race, gender, sexuality, religion, etc.
- No spam, scams, or commercial solicitation
- No explicit, sexual, or violent content
- No impersonation
- Keep it real — be honest about who you are
- Report bad behavior — we take reports seriously
- Consequences: warnings, temporary suspension, permanent ban depending on severity
- Contact: hello@washedup.app to report issues

---

### 4.5 Account Deletion (`/delete-account`)

**REQUIRED for Google Play Store.** Must be accessible without being signed into the app.

**Layout:**
- Page title: "Delete Your Account" (Cormorant Garamond Bold, 28px)
- Explanation paragraph: "If you'd like to delete your WashedUp account and all associated data, please enter your email address below. We'll process your request within 48 hours."
- What gets deleted (bullet list):
  - Your profile (name, photo, birthday, gender)
  - All messages you've sent in group chats
  - Your event/plan history
  - Your uploaded photos
  - Your push notification registration
- Email input field (use the standard input style from section 3.3)
- Submit button: "Request Account Deletion" (primary button style, var(--terracotta))
- After submission: Show a confirmation message: "Your deletion request has been received. We'll process it within 48 hours. You'll receive a confirmation email when complete."
- Optional: Also mention "You can also delete your account directly in the app: Profile > Delete Account"

**Backend:** On form submit, either:
1. Send an email to hello@washedup.app with the deletion request, OR
2. Insert a row into a `deletion_requests` table in Supabase with the email and timestamp

---

### 4.6 Support (`/support`)

Simple contact page.

- Title: "Support" or "Get Help"
- Email: hello@washedup.app (make it a clickable mailto: link)
- Brief text: "Have a question, found a bug, or need to report an issue? Reach out and we'll get back to you as soon as possible."
- Optionally include a simple contact form (name, email, message)

---

### 4.7 Shared Plan Deep Link (`/e/[id]`)

When users share a plan from the app, the URL format is: `https://washedup.app/e/{event_id}`

**For now:** This page should display a simple "open in app" interstitial:
- "View this plan on WashedUp"
- App Store download button
- Google Play download button
- Brief app description

**Future:** This could eventually fetch the plan from Supabase and display a read-only plan card, but that's not needed for launch.

---

## 5. Brand & Terminology Rules (STRICTLY ENFORCED)

These are not suggestions. Violating these rules makes the webapp feel disconnected from the mobile app.

| Rule | Details |
|---|---|
| Creator, not host | The person who creates a plan is the "creator". They are "posting" a plan. NEVER use "host", "hosting", "hosted", or any variant. |
| No emojis in text | Icons (SVG) are fine. Emoji characters (😀🎉🔥) in UI copy are forbidden. |
| App name | "WashedUp" — one word, capital W, capital U. Not "Washed Up", not "washedup", not "WASHEDUP". |
| Tagline options | "Find people to do things with" OR "Meet People in LA" |
| Tone | Warm, casual, inviting. Like a friend telling you about a cool thing. Never corporate, never formal, never salesy. |
| Not dating | This is NOT a dating app. Never use language that implies romantic matching. |
| Not networking | This is NOT LinkedIn. Never use "networking", "professional", "connect with industry". |
| Groups 3-8 | Always small groups. Never 1-on-1, never large events. The sweet spot is emphasized. |
| Activity-first | The plan/activity is the star. People join because the activity sounds fun, not to "meet people" as the primary goal. |

---

## 6. Supabase Connection

The webapp shares the exact same Supabase backend as the mobile app.

- **Project URL**: `https://upstjumasqblszevlgik.supabase.co`
- **Anon Key**: Use the same key as the mobile app. It should be stored in `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Install the Supabase client:
```bash
npm install @supabase/supabase-js
```

Create a client:
```tsx
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

**Important database notes:**
- The `events` table stores plans. Key columns: `id`, `title`, `start_time`, `location_text`, `primary_vibe`, `max_invites`, `member_count`, `status`, `creator_user_id`, `host_message` (this is the creator's note — the column is called host_message in the DB but we display it as the creator's note)
- Use `profiles_public` VIEW (not the `profiles` table) when displaying other users' info
- Event statuses: `forming`, `active`, `full` are live. `completed`, `cancelled` are past.
- `gender_rule` on events: `women_only`, `men_only`, `mixed`, `nonbinary_only`
- `member_count` on events is maintained by a database trigger — never manually update it

---

## 7. Favicon & Meta Tags

```html
<meta name="theme-color" content="#F8F5F0" />
<meta name="description" content="WashedUp — Find people to do things with in Los Angeles. Small groups, real activities, no pressure." />
<meta property="og:title" content="WashedUp — Meet People in LA" />
<meta property="og:description" content="Find people to do things with. Small groups of 3-8. Activity-first." />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://washedup.app" />
<!-- Create an OG image: 1200x630px, parchment background, "WashedUp" in Cormorant Garamond Bold, tagline in DM Sans -->
<meta property="og:image" content="https://washedup.app/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
```

---

## 8. Responsive Layout Guidelines

- Max content width: 720px for text-heavy pages (privacy, terms, guidelines)
- Max content width: 1080px for the landing page
- Horizontal padding: 16px on mobile, 24px on tablet, 32px on desktop
- Plan cards: Single column on mobile (full width minus padding). On desktop, can go 2-column grid with 16px gap.
- All pages centered horizontally with `margin: 0 auto`

---

## 9. Icon Library

The mobile app uses `lucide-react-native` and `@expo/vector-icons` (Ionicons). For the web, use:

```bash
npm install lucide-react
```

Key icons used in the mobile app:
- Heart (save/wishlist)
- Share2 or ArrowUpRight (share)
- Calendar (date)
- MapPin (location)
- User (person placeholder)
- CheckCircle (completed)
- ChevronRight (navigation arrows)

All icons: 14-18px, stroke-width 2, color from CSS variables (never hardcoded).
