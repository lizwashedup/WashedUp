# WashedUp — Global Context for Claude Code

## Product Vision

WashedUp is a platform for finding people to do things with. It is not a dating app. It is not a professional network. It is low-barrier, casual, and warm. The tone is always inviting, never formal.

## Forbidden Terminology

The word "host" and all its variants (hosting, hosted, isHost, hostRow, etc.) are forbidden in all UI copy, variable names, and style names. The person who creates a plan is the "creator" and they are "posting" a plan.

Database column names (host_id, host_message, creator_user_id) must never be changed.

## The Golden Hour Design System

Every color in the app must come from constants/Colors.ts. Every font family, size, and weight must come from constants/Typography.ts. There are zero exceptions. No hardcoded hex values. No hardcoded fontFamily strings.

Key values for reference:

- Background: Colors.parchment (#F8F5F0)
- Primary accent / buttons: Colors.terracotta (#D97746)
- Primary text: Colors.asphalt (#1E1E1E)
- Secondary text: Colors.textMedium (#666666)
- Placeholder / inactive: Colors.textLight (#999999)
- Card surface: Colors.cardBg (#FFFFFF)
- Input background: Colors.inputBg (#F0EBE3)
- Border / dividers: Colors.border (#E8E3DC)
- Error: Colors.errorRed (#E53935)
- White: Colors.white (#FFFFFF)

Key typography values:

- Fonts.sansBold — DM Sans Bold (buttons, labels, headings)
- Fonts.sansMedium — DM Sans Medium (UI text, chips)
- Fonts.sans — DM Sans Regular (body, meta)
- Fonts.displayBold — Cormorant Garamond Bold (plan titles, editorial)
- Fonts.headline — Plus Jakarta Sans Bold (onboarding headlines, phone-auth flow)
- FontSizes.bodyLG = 16, bodyMD = 14, bodySM = 13, caption = 11

## Navigation

Tab bar order: Plans | Scene | Post | Chats | Yours

The "Yours" tab's screen title is still "Your People". Profile is NOT a tab. It
is accessed from within the Yours screen.

## Design System Rules

### Primary color
#B5522E — this is the ONLY brand accent color. Use it for:
- All buttons (primary action)
- Section headers (TONIGHT, THIS WEEKEND, etc)
- Vibe/category tag text
- Calendar and pin icons on plan cards
- Notification badge dots
- The + button in the tab bar
- Any text links or accent elements
NEVER use #D97746, #A84B2A, #E8955A, or any other orange. Only #B5522E.

### Full color palette
- #B5522E — primary accent (buttons, icons, badges, links)
- #2C1810 — primary text (titles, names, bold numbers)
- #78695C — secondary text (dates, locations, metadata)
- #A09385 — tertiary text ("posted" labels, muted info, inactive tabs)
- #C5C0B8 — icon color (heart, share, muted UI icons)
- #FAF5EC — screen background (cream)
- #FFFFFF — card backgrounds
- #F5E8E2 — vibe tag pill background
- #F5EDE0 — card footer border, subtle dividers
- #E5DDD1 — borders on filter chips, input fields
- #D4BF82 — gold accent (creator message left border ONLY, decorative)
- #6B5D50 — creator message text
- #C43D2E — error states only

### Fonts
This project uses three custom font families, all loaded in `app/_layout.tsx` via `@expo-google-fonts`:

- **DM Sans** — all UI text, body, buttons, labels (Fonts.sans, Fonts.sansMedium, Fonts.sansSemibold, Fonts.sansBold)
- **Cormorant Garamond** — editorial display, hero headlines, plan titles (Fonts.display, Fonts.displayBold, Fonts.displayItalic)
- **Plus Jakarta Sans** — onboarding section headlines, phone-auth flow (Fonts.headline, Fonts.headlineMedium)

Always reference Fonts.* from `constants/Typography.ts`. Do not add new font families without discussion. Never hardcode fontFamily strings. The header wordmark "washedup" is a PNG image, not a font.

### Plan card pattern
- Creator avatar (real photo, 36px circle) with name + "posted" below
- NEVER say "Posted by", "is hosting", or "is going to" — just name and "posted"
- Plan title: 18px bold
- Category tags: pill shape, #F5E8E2 bg, #B5522E text
- Creator message: system font italic, 13px, #6B5D50, with 2px #D4BF82 left border
- Date/location with #B5522E icons
- Footer: "X of Y spots" + pill "Let's Go →" button with warm shadow
- Urgency badge "1 left" when almost full

### Button styles
- Primary: #B5522E background, white text, pill shape (border-radius 999), warm shadow (0 2px 8px rgba(181,82,46,0.3))
- Secondary: transparent background, 1.5px #B5522E border, #B5522E text
- Ghost: #B5522E text only, no background or border

### Button labels (permanent rule, founder 2026-07-19)
Button labels are 1 to 3 words and must NEVER wrap, at any width or text
size. Conversational copy belongs in body text above the button, never on
the button itself. Text links (ghost text, no fill) may run long; filled
buttons may not.

### Tabs pattern
- Full-width underline tabs, not pill bubbles
- Active: #2C1810 text, 2.5px #B5522E underline
- Inactive: #A09385 text, no underline

### Section headers
- 11px, font-weight 600, #B5522E, letter-spacing 1.5px, uppercase

### Empty states
- Never show "Nothing yet" or "No events found"
- Always write an invitation: "No plans this weekend — what sounds fun?"
- Include a CTA button

### Things to NEVER do
- Never use gold (#D4BF82 or #C5A55A) for text — decorative only (see Documented exceptions below)
- Never hardcode fontFamily strings — always reference Fonts from constants/Typography.ts
- Never hardcode colors — always reference the Colors file (constants/Colors.ts)
- Never say "host", "hosting", "Posted by", or "is going to" — always just "posted"
- Never remove the + button from the tab bar
- Never remove user profile photos from cards
- Never use #D97746, #A84B2A, #E8955A, or any other orange variant — only #B5522E

### Documented exceptions
The "gold is decorative only" rule has several intentional exceptions where gold *is* applied to a tappable surface. Each is tied to a specific psychological framing — gold signals "warm, optional, no pressure," in deliberate contrast to terracotta's "do this now."

- **Phone-auth OTP success state** uses #C5A55A intentionally (success affirmation, not a CTA).
- **"I'd go next time" interest signal button** (Next Time! feature, plan detail screen) uses #D4BF82 as a filled button. Reasoning: terracotta is reserved for primary CTAs ("I'm going," "Post It") that say "act now." Gold says "this is a low-pressure, optional micro-commitment." Treating this button as a primary terracotta CTA would over-weight what is by design a foot-in-the-door signal, not an action. The button after-tap state (checkmark + "[Creator] knows you're interested") also uses gold for the same reason.
- **"Message" button on the "you & [name]" keep page** (Yours / People) uses #D4BF82 as a filled button (asphalt text), sitting next to the terracotta-fill "Make a plan for you two." Same framing as the Next Time button: Message is the low-pressure warm nudge ("just say hi") versus the plan button's "do this now." Making Message a terracotta CTA would over-weight a deliberately soft action and flatten the warm/act-now contrast the keep page depends on. (This replaces the former gold "ping" button, retired when DMs landed; PingSheet/PingInline elsewhere are unaffected.)
- **"Invite" pill in the composer's INVITE PEOPLE section** (Post, `InvitePeopleSection`) uses the gold accent as a filled pill (asphalt text). It invites someone who already raised a hand (a want-in signal), so it is responsive and low-pressure, not a primary action: terracotta stays reserved for the composer's "Post It" CTA. Making each Invite pill terracotta would compete with that one true CTA and over-weight a soft, optional gesture.
- **"Make the first plan." nudge on an empty circle** (`CircleNoticeboard`, COMING UP empty state) uses the gold accent as a filled pill (asphalt text). It is a gentle invitation to start, not a demand; the circle page's real action row already carries the terracotta "post a plan" CTA above it. Gold keeps the empty-state nudge warm and skippable rather than nagging.
- **"Going ✓" confirmed state on the featured-event card** (`FeaturedEventCard`, `ctaButtonJoined`) uses a gold @28% fill (`goingConfirmedFill`) + hairline `gold` (#C5A55A) border + deep-brand `brandDeep` label. Same framing as the OTP-success affirmation above: this is a *confirmed-success state*, not a CTA — terracotta stays reserved for the un-joined "Let's Go →" action. Replaces the off-palette Material `successGreen` (#4CAF50); gold is the system's success color, never green. Label/check are dark, not gold (fill-only).
- **Gold eyebrow text on the post-plan survey celebration toast** (`PostPlanSurveyV3`, `toastEyebrow`, `Colors.gold`). The one place gold is *text*: a small uppercase eyebrow on the dark warm toast ("You both said yes." moment). On the dark ground, gold reads as candlelight, not as a link or CTA; the toast is a celebration, exactly the warm-affirmation register gold owns in this system. Do not use gold text on light backgrounds anywhere.
- **`goldenAmber` #F2A32D — the featured/live accent** (`Colors.goldenAmber` + `goldenAmberTint15`). A deliberate second warm accent reserved EXCLUSIVELY for editorial "this is happening" markers: the FEATURED pill label, the "happening now" tag, and their tint fills (PlanCard, FeaturedEventCard, plan detail). It is NOT a CTA color and never appears on buttons or links — terracotta keeps that job. Do not reach for goldenAmber outside featured/live markers.

Do not extend these exceptions to additional buttons or surfaces without writing it here first.

Green is not in the palette anywhere: the first-join "past the minimum" pill (2026-07-16) and the wishlist-confirmation check badge (2026-07-19) were both cut by founder decision. Gold is the system's success color; do not reintroduce green.

## General Rules

- Never change database column names or RPC function names.
- Never remove or change existing data fetching logic.
- When in doubt, ask before making a change.
- After every change, confirm what files you modified and summarize the changes.
