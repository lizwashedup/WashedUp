## September 19, 22:03 — conversation layout rejection

The founder rejected the actual topic-chat preview as clunky: detached reactions, displaced avatars, oversized header and crowded bottom composer. Do not treat earlier component rendering as visual acceptance. Reactions must visibly overlap their own bubble edge; sender alignment must follow the message, not the reaction row. Use the agreed compact WhatsApp interaction reference with WashedUp sunset branding. Keep the member profile top-right and all existing draft/permissions/transport safeguards. Check complete composer/edit/attachment states at ordinary phone widths and narrow widths; no app builds under the existing hold.

## September 19 — profile and community chat rows

Keep the signed-in member’s profile photo consistently at the top right of the app. Reuse the existing Profile destination; no long-press-only navigation. Keep other actions from crowding the title. Full header coverage still requires implementation and verification.

Community chat entries use the approved sunset-gold gradient, compact rows and Open/Join on the right. The introduction icon must look like a wave, not a stop hand. No sparkle/starburst symbols. No top-of-list Mute all suggestion: notification settings belong inside chats. Creators currently rename rooms; icons are app-assigned, with no picker implemented.

## September 19 — permanent icon direction

The founder explicitly rejects the sparkle/four-point star symbol everywhere in the app. Do not use Sparkles/Sparkle icons, decorative ✨/✦/✧ marks, or equivalent starburst artwork in product UI. Use meaningful conversation/people/calendar icons or omit decoration. This is a design restriction, not a filter on member-authored messages.

Community chat lists are entry points to the actual conversations. Do not place Mute all or notification-setting prompts at the top of that list; keep notification controls inside chat. Preserve each room’s existing destination and explicit optional-group joining.

**September 18 latest direction:** Founder likes the current creator sunset gradient; continue that direction. A separately authorized narrow live signup-to-Plans OTA is now published and provider verified; redesign remains private. Preserve this Plans exit in subsequent builds. See the controlling brief and hotfix release record.

**September 18, 19:56 gold/depth direction:** Founder explicitly requests a plus icon, restrained gold highlights and sunset dimension in the creator invitation action. This overrides older gold-only-for-note-border guidance for these decorative creator accents. Keep labels/contrast and permission meaning independent of color. Current local pairing is Newsreader + Inter for creator pages; native/full visual acceptance remains open.

**September 18 typography update:** The founder subsequently rejected DM Sans 600 and explicitly requested a stronger pairing. Compare and internally verify alternatives on the actual connected screens; no replacement is approved merely because its assets were downloaded. Continue centralizing all fonts in Typography constants. The controlling brief and September 24 release-target record carry the latest scope and acceptance requirements.

**Earlier typography/Post correction (font retention superseded above):** Use WashedUp’s established DM Sans and Cormorant Garamond (existing onboarding fonts unchanged), superseding alternate-font guidance below. Preserve Post’s current layout/flow with all existing category choices visible. September 16 plan safe-area/scroll fix is part of the bounded corrections.

**Controlling brief: [September 16 consolidated founder instruction](/Users/liz/Desktop/WashedUp/REDESIGN-CONSOLIDATED-BRIEF-2026-09-16.md).** Supersedes conflicting earlier directions. WhatsApp-quality conversation interaction in WashedUp branding; live Plans quality; selected sunset Figma Scene and complete creator journeys. Internal build/test milestones only; no unfinished builds presented for founder QA. All release requirements and existing permission boundaries retained.

## Controlling founder direction — September 16, 2026

Read [REDESIGN-FOUNDER-DIRECTION-2026-09-16.md](/Users/liz/Desktop/WashedUp/REDESIGN-FOUNDER-DIRECTION-2026-09-16.md) and subsequent explicit feedback. Scene/community/organization/event/creator are the primary redesign, with selected Figma and excellent chat required. Latest instruction restores existing member-facing appearance to the live app; earlier staged member appearance/title-first acceptance is not acceptance of the rejected screens. Restore presentation through existing components while retaining permission, privacy, transport, introduction, history and creator engineering. Do not flip community grouping or creator-access flags to control appearance. Finish bounded Plans/detail/map/chat corrections, update the separate private phone build and verify actual journeys; then return to Scene/creator. No indefinite regression detour, broad source rollback or replacement messaging system. Existing production/deployment boundaries remain.

# WashedUp — Global Context for Codex

## September 14 founder correction — privacy and quality

Handles are not public discovery information. Show another person's handle only from an accepted People relationship; shared plan attendance alone is insufficient. Do not add public profile/attendee handle enrichment or arbitrary request buttons. Existing intentional known-handle, shared-history and invitation flows must be checked against their established eligibility. Plan detail now uses the accepted-People map with current-account ownership; public profile/member rows do not supply display handles.

The founder explicitly says the live plan detail is stronger than the current redesign preview. Do not mark it visually complete or describe the gap as only minor polish. Compare whole flows against the existing/live reference; preserve strengths and improve usability before claiming the redesign is an upgrade. Figma review artifacts, code implementation, visual acceptance and native/backend verification are different states.

## Product Vision

WashedUp is a platform for finding people to do things with. It is not a dating app. It is not a professional network. It is low-barrier, casual, and warm. The tone is always inviting, never formal.

## Forbidden Terminology

The word "host" and all its variants (hosting, hosted, isHost, hostRow, etc.) are forbidden in all UI copy, variable names, and style names. The person who creates a plan is the "creator" and they are "posting" a plan.

Database column names (host_id, host_message, creator_user_id) must never be changed.

## The Golden Hour Design System

Every color in the app must come from constants/Colors.ts. Every font family, size, and weight must come from constants/Typography.ts. There are zero exceptions. No hardcoded hex values. No hardcoded fontFamily strings.

Key values for reference:

- Background: Colors.parchment (#FAF5EC)
- Primary accent / buttons: Colors.terracotta (#B5522E)
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

### September 12 staged redesign

Liz selected the cream/ink/clay and Mona Sans direction in the redesign review and authorized staged isolated implementation. `AfterglowColors` and the Afterglow typography exports are the opt-in token family for those reviewed screens. The development-gated community directory, outer inbox, shared conversation headers and message appearance, photo viewing and community/topic plus Plan/Circle/DM message entry use the optional Afterglow appearance. This now extends to attachment controls and the existing PlanCard inside Yours → Plans; retain its underlying collection logic. On September 13 Liz approved title-first Plan cards: title and activity details lead, with the complete creator photo/name/profile row near the join controls. This is the shared PlanCard default in the isolated copy; the older creator-first and avatar-only activity-first variants remain available for comparison, not as the feed selection. Use the native phone keyboard for ordinary emoji entry in the staged mobile composer; message reactions remain separate. The root notification reminder also accepts that opt-in appearance, with pending/retry feedback and reachable dismissal. Continue the port one reviewed component at a time. Keep all color and typography definitions in the constants files above. Do not globally replace the existing palette/fonts or restyle the bottom navigation. Static font provenance and remaining device checks are documented in `docs/native-chat-visual-system-2026-09-12.md`. The existing unnamed-Circle naming sheet and its cover placeholder also accept this opt-in type/palette through the development flag; the rest of the Circle detail remains for its staged port. The September 13 People photo-left row candidate is now ported behind the same development flag: optional appearance reaches the Yours header/tabs, populated People/search rows and person menu. Retain accepted relationships, sorting, exact-handle lookup and original routes. Full-color photos replace recency fading only in this optional presentation. The optional presentation now reaches incoming requests and minimal-profile sheets; pending/error/unavailable states are explicit, staged Block/No thanks stays available until dismissed, and minimal profiles use compact content-sized sheets. Request/profile connection writes carry per-call account/visit ownership through actual mutation dispatch. The optional appearance now also reaches Add-people paths and the full relationship page through Yours and its existing route. Exact-handle lookup, completed-plan history and request-versus-accepted states remain; full modal closure, scoped asynchronous results, truthful invitation copy, loading/error/retry and QR fallbacks are part of the isolated implementation. Relationship stats describe their upcoming plans and album-backed shared memories, not assumed mutual attendance or the first meeting. The Circle directory, member rows and noticeboard now also accept the optional appearance through Yours and the existing Circle route. Preserve joined-circle ordering, named-pair versus unnamed-DM classification, manual cover then permitted shared imagery then monogram, and the original plan/chat/invite destinations. Read failures remain distinct from an empty calendar; the directory and calendar now carry account-generation ownership, and suggestion dismissal needs a confirmed result with retry. The plan privacy label does not claim restricted access when visibility is unknown. Circle creation, Add people and Circle plan forms now accept the same optional appearance through their existing routes. Keep their accepted people, admission policies, required fields and private/subset/public destinations. Confirmed Circle creation retains its ID through optional setup retry; unknown creation directs to Circles. Shared category/place/date/time controls preserve their existing callbacks and default appearance. Existing handles now appear below names in Circle people/permission/add/plan selectors. Circle-plan creation validates its receipt, blocks another submission after an unknown result in the same active visit, and returns to refresh the Circle plans; this is not server idempotency. The individual profile now accepts the optional appearance, including its confirmation dialog, and uses existing handles, portrait fallbacks, error/retry/unavailable states and original visible history/actions. Scoped reads and Message/remove/block actions preserve account/target/visit ownership. Own-profile/settings now accept the optional appearance, preserving original editable fields, limits, read-only gender, routes and account/notification safeguards. Handle checks distinguish unknown, taken and available; failed saves retain drafts. Current-account/edit ownership, pending-exit guards and fresh-read reconciliation prevent stale save feedback, while confirmed account deletion retains its account-owned cleanup through navigation. The main plan composer and its people picker, confirmation and sharing now also accept the optional appearance. Preserve required post versus draft fields, capacity/audience rules, existing title/URL share payload and invitation retry against the saved plan. Photo work is scoped to its initiating account, focused visit and attempt; rapid actions cannot overlap it. A confirmation allows one exit per visible visit. Cold-entry Cancel returns to Plans when no back history exists. Plans discovery now also opts into the shared card/Featured/filter appearance. Preserve the eligible feed, date/category/duplicate grouping and navigation. Saving checks returned receipts, uses account/visit-owned per-plan locks and exact rollback, and retries the original desired saved state; only confirmed saves show the compact snackbar. Filter contents scroll above a reachable Done action, with visible-visit dismissal guards. Near me stays explicit-tap/default-off with the original cached fix and distance presets; unavailable retries location, denied opens Settings, and pending/retired attempts cannot alter a new visit. Plan detail overview and the ordinary joining introduction now also accept the optional appearance. Preserve required introductions, the existing attendance check and ordinary age/gender/capacity rules. Circle admission must use validated current provenance and outsider availability; show actual total attendance separately and preserve Circle-member bypass. Do not route missing context through ordinary joining or promise ordinary waitlist notifications for a full Circle. Existing Circle chat destinations remain when there is no own plan chat. Confirmed joining remains final when optional introduction delivery fails; retain the attempted introduction with scoped recovery and do not send it automatically again. An unknown membership receipt remains unresolved until fresh membership evidence supplies the member view, without automatic retry. Cached details and pending recovery stay mounted through background refresh failure. Existing participation notice copy and assent semantics remain, with native sibling sheets sequenced by dismissal. Waitlist exception acceptance/decline are scoped to their initiating account, plan, notice and visit. Plan leave/cancellation now share a compact confirmation with scoped exact-row receipts, rejection retry and fresh-read recovery for uncertain results. Confirmed departure stays final when an optional event-chat announcement fails; whole-Circle plans without an event chat omit that announcement. Future cancelled/completed plans no longer offer joining or creator management; existing member chat access remains. The creator editor now seeds Featured fields per opening, keeps untouched custom ages and exact timestamps out of updates, preserves valid duration on a date change, and omits ordinary/Featured capacity editing for Circles. Its optional visual port now includes a reachable Save footer, named controls and readable selections. Save/photo work carries account, focused-visit and edit ownership with immediate pending locks; exact save receipts and read-only checking preserve uncertain attempts. Failed photo replacement retains the existing image, and typed locations clear stale coordinates. Ordinary waitlists now use own-row receipts, scoped reads and pending locks, original-action retry and read-only uncertain-result recovery. Recovery stays reachable when capacity changes; Circle admission remains separate. The optional waitlist and duplicate-choice presentation preserves existing destinations and creator opt-out. Direct invitation replies now use deterministic recipient reads and exact pending-row receipts. Opening joining does not accept the invitation; confirmed membership precedes acknowledgement, and a failed optional reply never undoes joining. Retry and read-only uncertain-result checking are separate, with account/visit ownership. Creator waitlist management now accepts the optional appearance, preserving FIFO eligibility, intentional masking, the three extra spots and original RPCs. Fresh preflight reads, shared pending locks, original-action retry and read-only uncertain-result recovery are scoped to the current account and visit. Pause invites describes extra invitations only; ordinary queue admission remains. Next time interest now uses exact own-signal reads, UUID receipts, scoped pending guards and read-only uncertain-result checking. It remains separate from current age/gender/capacity admission, while requiring current visibility/lifecycle and membership evidence; private Circle outsiders cannot dispatch interest. Confirmed copy says Interest saved, without claiming the creator has seen it. Creator interest reads distinguish failure from empty. Shared Circle cards now preserve confirmed provenance and outsider availability separately from total attendance, with one Friends group badge and a short explanation. Private/unknown/zero-availability cards open details without ordinary waitlist or duplicate actions; personal collections preserve provenance and leave unavailable counts unknown. Stored Circle caps, including the two-person DM exception, remain. Shared standard/Featured cards now use detail lifecycle rules and retain status/end times through adapters. Closed cards say Cancelled, Completed or Ended with View plan, suppress admission/urgency and stay readable in the optional appearance. Local start/cutoff clocks refresh mounted cards and Yours sections, including AppState return; explicit end times override the three-hour fallback. The creator event overview now uses the optional appearance, event-scoped role checks and account-owned read-only queries. Preserve the existing management/finance split and original destinations; unknown ticket/sales results must not appear as zero. The simulator component-review toolbar is not final app navigation. The September 14 local simulator now imports the actual app root/router and original bottom navigation using fictional read-only services; all five main destinations and plan-detail Back were checked. This does not make titles, remaining screens or backend integration final. See docs/native-app-shell-2026-09-14.md. Joined-card CTA parity now shows Going for active participants and suppresses admission pressure, with explicit departures excluded from feed membership. Closed plans retain View plan. Continue header/spacing consistency, Scene and tab accessibility counts without replacing the real navigation. Creator/organization and remaining auxiliary surfaces plus native/server integration remain outstanding. Existing acceptance/blocking RPC semantics and all original navigation remain. These instructions reflect the accepted session direction and do not authorize production deployment or data changes.

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

## Session-Learned Rules

- Canonical admin tool is washedup-world, not command-center-next. Decided 2026-08-13, delegated by Josh directly to Codex's judgment ("you tell me which one"). command-center-next has a live anon-key-reachable gap on its 7 Headquarters tables plus dead code (706-line dead stats route, fake /finance data); washedup-world's own commit history already shows it actively porting sections FROM command-center-next. No new admin feature work goes into command-center-next going forward.
