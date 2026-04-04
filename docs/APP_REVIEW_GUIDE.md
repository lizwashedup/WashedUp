# WashedUp — App Review Guide

## Guideline 1.2: User-Generated Content Compliance

WashedUp is a social activity app for finding people to do things with in Los Angeles. Below is a walkthrough of every UGC safeguard in place.

---

### 1. Terms Agreement (EULA with Zero Tolerance Language)

**Where:** Signup screen — before account creation

- A checkbox requires users to agree to our Terms of Service, Privacy Policy, and Community Guidelines before signing up.
- The "Sign Up" button, "Continue with Apple," and "Continue with Google" buttons are all disabled and visually dimmed until the checkbox is checked.
- Links to all three documents are tappable and open in the browser.
- Our Terms of Service at [https://washedup.app/terms](https://washedup.app/terms) include explicit zero-tolerance language:

> "WashedUp has zero tolerance for objectionable content or abusive users. We do not permit harassment, hate speech, discrimination, spam, explicit content, or any conduct that violates our Community Guidelines. Users who post such content or engage in abusive behavior will have their content removed and their accounts suspended or permanently banned. We review all reports within 24 hours and take action accordingly."

**How to verify:** Open the app → tap "Sign Up" → observe the checkbox and disabled buttons.

---

### 2. Content Filtering

**Where:** All user-generated text inputs

The app filters objectionable language (profanity, slurs, hate speech, threats, sexual content) before submission. Filtered inputs include:

- First name (signup)
- City (onboarding)
- User handle (friends screen)
- Plan title, description, creator message, and location (post screen)
- Join greeting message (plan detail)
- Chat messages (group chat)

If blocked content is detected, the submission is rejected with a message: "Your message contains language that goes against our community guidelines."

**How to verify:** Open any chat → type a profanity → tap Send → observe the rejection alert.

---

### 3. Flagging Objectionable Content (Report Mechanism)

**Where:** Available on every surface where user content appears

Users can report other users from:

- **Plans feed:** Long-press any plan card → "Report this plan"
- **Plan detail screen:** Tap the ellipsis menu → "Report [Name]"
- **Group chat:** Tap the ellipsis menu → select a member → "Report User"
- **Friends / People screen:** Tap a user's photo → "Report" button
- **Any profile popup:** Tap a user's photo anywhere in the app → "Report" button

Reports are submitted with a reason (Inappropriate behavior, Harassment, Fake profile, No-show, Made me feel unsafe, or Other). The app confirms: "Your report is anonymous. We review all reports within 24 hours."

**How to verify:** Open any plan → tap a member's photo → tap "Report" → select a reason → submit.

---

### 4. Blocking Abusive Users

**Where:** Available on every surface where user content appears

Users can block other users from:

- **Plans feed:** Long-press any plan card → "Block [Name]"
- **Plan detail screen:** Tap the ellipsis menu → "Block [Name]"
- **Group chat:** Tap the ellipsis menu → select a member → "Block User"
- **Friends / People screen:** Tap a user's photo → "Block" button
- **Any profile popup:** Tap a user's photo anywhere in the app → "Block" button

**What blocking does:**

1. **Notifies the developer:** Every block automatically creates a report entry, which triggers an email alert to the development team via our reporting system.
2. **Instant removal from feed:** Blocked users are immediately removed from the blocker's feed, plan cards, member lists, friend lists, and all other surfaces. The app invalidates all cached data to ensure instant removal.
3. The blocked user is not notified.

**How to verify:** Open any plan → tap a member's photo → tap "Block" → confirm → observe the user is immediately removed from your feed.

---

### 5. Developer Action Within 24 Hours

**How we monitor and act:**

- Every report and every block triggers an automated email alert to our team (via Resend email API + Supabase database trigger).
- The email includes: reason, reporter identity, reported user identity, associated plan (if any), and a reminder to act within 24 hours.
- Our process: review the report, remove violating content, and suspend or ban the offending user as appropriate.
- The ReportModal in the app states: "We review all reports within 24 hours."

---

### 6. Support URL

Our support page is available at: [https://washedup.app/support](https://washedup.app/support)

Users can reach us via email at [hello@washedup.app](mailto:hello@washedup.app).

---

### Test Account

To test the app during review:

- Email: [REPLACE WITH TEST ACCOUNT EMAIL]
- Password: [REPLACE WITH TEST ACCOUNT PASSWORD]

Suggested test flow:

1. Log in with the test account
2. Browse plans on the Plans tab
3. View events on the Scene tab
4. Join a plan to see the group chat
5. Try posting a plan from the Post tab
6. Long-press a plan card to see Report and Block options
7. Tap a member's photo to see the profile popup with Report and Block
8. Open a chat and try sending a message with a link (it will be clickable)

