---
omd: 0.1
brand: WashedUp Golden Hour
---

# 1. Visual Theme & Atmosphere

Warm, human, low-pressure, and unmistakably social. The product should feel like late-afternoon Los Angeles: parchment ground, white cards, warm terracotta actions, editorial titles, and quiet supporting detail. It must never read as a dating app, professional network, or formal event platform.

# 2. Color Palette & Roles

- Terracotta `#B5522E`: the only primary brand accent; buttons, active states, links, section labels, and plan metadata icons.
- Parchment `#FAF5EC`: primary app background.
- Asphalt `#1E1E1E`: primary text and action icons.
- Dark warm `#2C1810`: warm editorial text and deep emphasis.
- Secondary `#78695C`: dates, locations, and secondary text.
- Tertiary `#A09385`: muted labels and inactive states.
- Card white `#FFFFFF`: card and raised surface background.
- Warm border `#E5DDD1`: input and control borders.
- Accent subtle `#F5E8E2`: category and selected-pill fill.
- Divider warm `#F5EDE0`: card footers and subtle dividers.
- Gold accent `#D4BF82`: decorative and explicitly documented soft-success uses only.
- Error brand `#C43D2E`: errors only.

All implementation colors must be referenced through `constants/Colors.ts`. Do not place raw color values in component code.

# 3. Typography Rules

- DM Sans: all interface text, body copy, buttons, labels, and metadata. Use only `Fonts.sans`, `Fonts.sansMedium`, `Fonts.sansSemibold`, or `Fonts.sansBold` from `constants/Typography.ts`.
- Cormorant Garamond: editorial display and plan titles. Use only `Fonts.display`, `Fonts.displayBold`, or `Fonts.displayItalic`.
- Plus Jakarta Sans: onboarding and phone-auth headlines only. Use `Fonts.headline` or `Fonts.headlineMedium`.

All sizes must use `FontSizes` and every font family must use `Fonts`. Button labels are one to three words and may never wrap.

# 4. Component Stylings

- Cards use a white surface, 16px radius, restrained warm elevation, and clear internal hierarchy.
- Primary actions use terracotta fill, white text, pill geometry, and warm shadow.
- Secondary actions use transparent fill, terracotta border, and terracotta text.
- Category tags use the subtle warm fill and terracotta or approved category text.
- Plan cards retain the title, category, creator note, date, location, capacity, share, save, and join action. Experiments may reorder these elements but may not remove data or behavior.
- Creator photos remain present on every plan card. Creator identity may be visually reduced in an approved experiment, but profile access and accessibility labels must remain.

# 5. Layout Principles

- Lead with the user decision or activity, then supporting context, then action.
- Keep card spacing compact but breathable and preserve the existing feed width and rhythm.
- Use a single dominant action per card.
- Keep metadata scannable in short rows; do not bury dates, places, capacity, or privacy state.

# 6. Depth & Elevation

- Use the existing card shadow tokens and component pattern.
- Avoid floating glass, glossy gradients, and decorative elevation unrelated to hierarchy.
- Overlapping avatars may use a warm surface border to maintain separation.

# 7. Do's and Don'ts

- Do keep the product warm, casual, and low-pressure.
- Do preserve creator photos, navigation, accessibility, and all current plan actions.
- Do use the existing color and typography constants exclusively.
- Don't use the words host, hosting, hosted, or "Posted by" in UI or new variable names.
- Don't invent colors, font families, button styles, or interaction behavior.
- Don't remove the Post tab action or regress existing plan-card data and controls.
- Don't ship an experimental layout without an explicit release decision.

# 8. Responsive Behavior

- Plan cards must work at narrow phone widths and in the existing 300px horizontal carousel.
- Titles may use two lines; button labels must never wrap.
- Avatar stacks must cap their visible count and must not displace the capacity label or CTA.
- Touch targets and accessibility labels remain usable at all supported widths.

# 9. Agent Prompt Guide

Build with the Golden Hour tokens already exposed by `Colors`, `Fonts`, and `FontSizes`. Preserve current behavior and data flow. For the activity-first plan-card experiment, move the activity title to the first visual position, place share/save beside it, and move a small creator photo plus faded attendee stack to the footer. Hide the creator name only on the experimental feed card. Do not change the opened plan, other plan-card surfaces, business logic, or production defaults.

# 10. Voice & Tone

Inviting, plain, human, and lightly conversational. Avoid formal event-management language, pressure, and judgment. Use "creator" and "posted" where identity is shown.

# 11. Brand Narrative

WashedUp helps people find people to do things with. The interface should make showing up feel easy, safe, and ordinary, with the activity as the social bridge.

# 12. Principles

1. Lower the barrier to joining or posting.
2. Put the activity before social status.
3. Preserve trust through real people, clear logistics, and predictable actions.
4. Make experiments additive, reversible, and isolated from proven paths.

# 13. Personas

- A person browsing for something easy to join without feeling exposed.
- A creator posting a casual plan and wanting it to feel welcoming rather than performative.
- A returning member scanning dates, places, capacity, and familiar faces quickly.

# 14. States (empty/error/loading)

- Empty states are invitations and include a clear action; never say "Nothing yet" or "No events found."
- Loading states preserve layout stability and avoid false content.
- Errors use the approved error token, plain recovery copy, and never destroy entered work.
- Full, waitlist, completed, featured, live, circle-private, and circle-open plan states must retain their existing labels and actions.

# 15. Motion & Easing

- Preserve the current 300ms card entrance and existing bookmark, urgency, and button feedback.
- Motion must clarify state, not decorate the surface.
- Do not introduce looping decorative motion, parallax, or animation that delays interaction.
