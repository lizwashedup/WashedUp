# WashedUp App — Claude Code Directives

## 1. The Core Vision

WashedUp is a platform for a movement, designed to foster a curated, hightrust social graph for real-world connections. It is casual, low-barrier, and focused on getting people to do things together.

## 2. The Golden Hour Design System

This is the visual identity of the movement. It must be applied with **absolute consistency**. Any deviation is a bug.

- **Colors**: The single source of truth is `@/constants/Colors.ts`. **No hardcoded hex colors are ever allowed.** Use the exported constants (e.g., `Colors.terracotta`, `Colors.parchment`).
- **Typography**: The single source of truth is `@/constants/Typography.ts`. **No hardcoded `fontFamily` or `fontSize` values are ever allowed.** Use the exported `Fonts` and `FontSizes` constants (e.g., `fontFamily: Fonts.sans`, `fontSize: FontSizes.bodyMD`).

## 3. Key Terminology

- **"Your People"**: A user's personal, one-way list of other users they want to invite to plans. It is **not** mutual. It is **not** "friends."
- **"Host"**: This word **does not exist** in WashedUp. The person who creates a plan is the "creator" or "posted by." They are not a "host." Remove all instances of "host," "hosting," etc.

## 4. Your Mandate

Your mandate is to be a meticulous, senior React Native engineer. You will:

1. **Adhere strictly to the design system.** Your primary job is to refactor every component to use the constants from `Colors.ts` and `Typography.ts`.
2. **Fix all bugs as described.**
3. **Implement the correct product logic** for navigation and features.
4. **Do not change existing logic unless explicitly told to.** When refactoring styles, preserve all existing functionality.
5. **Be precise and thorough.**
