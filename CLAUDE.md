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
- FontSizes.bodyLG = 16, bodyMD = 14, bodySM = 13, caption = 11

## Navigation

Tab bar order: Plans | Scene | Post | Chats | Your People

Profile is NOT a tab. It is accessed from within the Your People screen.

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
- DO NOT install or use Plus Jakarta Sans, DM Sans, or any custom fonts
- Use the system font for everything (the default iOS/Android font)
- Cochin is ONLY used for the logo wordmark. Never use Cochin anywhere else in the app. Creator messages use system font italic.
- The header wordmark "washedup" is a PNG image, not a font

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
- Never use gold (#D4BF82 or #C5A55A) for text — decorative only
- Never use custom fonts — system font only
- Never hardcode colors — always reference the Colors file (constants/Colors.ts)
- Never say "host", "hosting", "Posted by", or "is going to" — always just "posted"
- Never remove the + button from the tab bar
- Never remove user profile photos from cards
- Never use #D97746, #A84B2A, #E8955A, or any other orange variant — only #B5522E

## General Rules

- Never change database column names or RPC function names.
- Never remove or change existing data fetching logic.
- When in doubt, ask before making a change.
- After every change, confirm what files you modified and summarize the changes.
