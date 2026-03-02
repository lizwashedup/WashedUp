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

## General Rules

- Never change database column names or RPC function names.
- Never remove or change existing data fetching logic.
- When in doubt, ask before making a change.
- After every change, confirm what files you modified and summarize the changes.
