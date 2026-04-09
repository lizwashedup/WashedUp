# App Store Guideline 1.2 — Required Updates

Apple requires specific language and behavior for apps with user-generated content. This doc lists what to add/verify.

## 1. Terms of Service (washedup.app/terms)

**Add explicit "no tolerance" language.** Apple requires: *"these terms must make it clear that there is no tolerance for objectionable content or abusive users"*.

Add this paragraph near the top of the Terms (e.g., after the intro or in Section 3 User-Generated Content):

> **Zero Tolerance.** WashedUp has zero tolerance for objectionable content or abusive users. We do not permit harassment, hate speech, discrimination, spam, explicit content, or any conduct that violates our Community Guidelines. Users who post such content or engage in abusive behavior will have their content removed and their accounts suspended or permanently banned. We review all reports within 24 hours and take action accordingly.

Also ensure Section 4 (Content Moderation) or equivalent includes:

> We review all reports within 24 hours. We will remove violating content and take action against offending users, including suspension or permanent ban.

---

## 2. In-App (Already Implemented)

- **EULA / Terms agreement** — Signup requires checkbox for Terms, Privacy, Community Guidelines ✅
- **Content filtering** — `lib/contentFilter.ts` blocks profanity/slurs in plans, chat, profile ✅
- **Report mechanism** — ReportModal on plans, events, chat, friends; reports go to `reports` table ✅
- **Block mechanism** — useBlock on plans, events, chat, friends ✅
- **Block → notify developer** — When user blocks, a report is inserted so you’re notified ✅
- **Block → instant feed removal** — Query invalidation removes blocked users from feed immediately ✅
- **24-hour commitment** — ReportModal says "We review all reports within 24 hours" ✅

---

## 3. Operational (Your Responsibility)

Apple expects you to **act on reports within 24 hours** by removing content and ejecting offending users. Set up a process to:

1. Monitor the `reports` table (including "Blocked by user" entries)
2. Review and remove violating content
3. Suspend or ban offending accounts
4. Respond within 24 hours
