# Liz approval pack preparation

Status: PREPARATION ONLY. Nothing here authorizes a release, flag change, migration apply, or production change.

This pack uses the 5 August 39-page foundation plus Liz's later Product Q&A, Creator Space inventory, Scene specifications, and corrected Circles functional spec. Later direct answers supersede only conflicts. It excludes questions Liz has already answered.

## Questions that can be asked now

### 1. Existing Communities

Liz already decided that creators explicitly choose open joining or approval-required joining for new Communities. Do not ask that again.

All five existing live Communities currently have `open` recorded. What should happen to those five?

- Keep each existing Community open unless its creator changes it.
- Change each existing Community to approval-required.
- Require each creator to choose before the next person can join.

No existing row will be changed until Liz answers and Josh separately approves a production plan.

### 2. Organizer account deletion with money still owed

If an organizer asks to delete their account while a ticket payout is still owed, which policy should the app use?

- Block deletion until the payout is completed.
- Allow deletion while retaining only the financial record needed to complete the payout.

Do not present forfeiture as an option. The local protection is review-only.

### 3. Event-room photo retention after closure

Liz already decided that a temporary event room closes at `event_end + 48h` and remains separate from the persistent Community room. The unresolved question is what happens to its photos after closure:

- Delete the photos.
- Keep them in a private, view-only attendee archive.
- Give attendees a save window, then delete them.

The current local implementation follows the second option. It closes uploads and keeps existing photos view-only. That is a prepared implementation, not an approved retention policy.

### 4. Circle plan outside-person cap

The corrected Circles spec says a standard Plan caps at 8 total, a two-person DM Plan remains capped at 8 total, and a Circle Plan can include all Circle members plus outside people. One number still conflicts across source documents: should the outside-person cap on an opened Circle Plan be 7 or 8?

The current technical artifact uses 7. Treat that as unapproved until Liz confirms it.

### 5. User-facing Circle term

Should `Circle` be the permanent user-facing product term? The corrected Circles spec uses it, but its own open-question table says the earlier development document kept it internal and had not settled the public term.

Do not rename database columns or RPCs as part of this copy decision.

## Evidence packs engineering must finish before asking for signoff

### Event-room albums and visible copy

Current local behavior:

- The Community creator can turn photos on for an event room.
- Room participants can add photos while the room is active.
- A save notice appears during the final 24 hours.
- Uploads stop after closure and existing photos become view-only.

Current visible copy includes:

- `turn on photos for this event?`
- `anyone in the room can add what they took.`
- `this room closes soon -- save what you want to keep.`
- `this room is closed. photos are view-only.`

Required evidence:

1. Photos off, viewed as the Community creator.
2. Photos off, viewed as a participant.
3. Active album with no photos.
4. Active album with realistic photos.
5. Final-24-hour save notice.
6. Closed, view-only album.
7. Upload attempt blocked after closure.

After Liz answers retention question 3, ask her to approve or rewrite the visible copy and approve the matching screens for a review build.

### Chat deletion

Current behavior:

- Removes the DM from the caller's chat list only.
- The other person keeps their copy.
- Messaging the person later starts a new thread.
- Plan chats are unaffected.

Current placeholder copy:

- Title: `Delete this chat?`
- Body: `This deletes the chat from your list. [Name] keeps their copy. Messaging them again starts a new chat.`
- Safe action: `Keep it`
- Delete action: `Delete`

Required evidence:

1. Chats tab with a DM row.
2. Long-press confirmation for that row.

Then ask Liz to approve or rewrite the strings and approve inclusion in a review build. Do not activate the flag only because the copy exists.

### Community member and join states

Community and Organization grammar must remain separate:

- A Community has members and a Join door.
- An Organization has followers and a Follow action.
- Do not show `follow` or `following` as the Community membership action.

For the Community event-card review, prepare these states:

1. Active member with a passive member-status label.
2. Nonmember with an open Join action.
3. Nonmember with an approval-required Ask to join action.
4. Pending request state.

Ask Liz only to approve or rewrite the visible Community labels and the review-build presentation. Any current Follow and Join blending on a Community surface is an engineering defect to fix, not a product question for Liz.

### Community join settings

Liz has already approved explicit creator choice between open and approval-required. Do not ask that question again.

The Creator Space inventory also depicts invite-only, but invite-code generation and redemption are not implemented. The repaired local SQL proposal rejects invite-only instead of silently converting it to manual review. Keep invite-only out of the review request unless it is clearly labeled as future scope.

Required evidence:

1. Creator settings in open mode and the public Join result.
2. Creator settings in approval-required mode and the public request/review result.
3. Proof that new Community creation records an explicit choice instead of silently inheriting a default.

Then ask Liz to approve or rewrite the visible labels and approve inclusion in a review build.

### Ticket wallet organization

Liz explicitly marked wallet grouping as needing review. Prepare realistic data before asking.

Show the current list beside:

- Option A: one chronological wallet with named status headings.
- Option B: Purchased and RSVP/Ticket due sections, with completed and refunded history below.

Every version must include a purchased upcoming ticket, RSVP with ticket due, checked-in or expired ticket, and refunded ticket. Then ask Liz to choose the organization and approve its labels.

### Circles presentation

The corrected Circles spec settles many mechanics, but it still marks several visible choices for confirmation. Prepare side-by-side evidence for:

1. Manual create from Yours.
2. Co-attendance suggestion.
3. Optional versus creation-time name, description, and photo.
4. Exact-handle lookup included versus removed.
5. Plan release control on the card, in chat, or both.

The current suggestion SQL uses the older engineering draft's conservative exact-whole-roster interpretation. Label it as engineering v1, not as Liz's wording.

Do not re-ask whether Circles stays on the roadmap, the 3 people across 3 Plans trigger, simultaneous Circle Plans, DM storage mechanics, or sub-activity scope already handled in prior discussion. Ask the cap and user-facing-term questions above directly because Liz's corrected spec itself still marks them open.

### Automatic moderation, contingent alternative

The current live automatic path has technical safety gaps. The default local technical hardening package does not replace that function or choose a moderation policy.

A separate review-only artifact, `technical-moderation-alternative.sql`, preserves one possible hardened automatic path with distinct reporters, self-report and block-only rejection, session revocation, deduplicated actions, and durable failures. It is contingent on Liz choosing automatic enforcement and its policy details. It is excluded from the default private gate and is not an approved build plan.

A human-review workflow is the other policy direction. It has not been selected or built. Do not present either path as approved or required engineering work.

If Liz wants the alternative explored, prepare one concrete comparison that states:

1. What counts as an independent report.
2. Automatic restriction versus opening human review.
3. Session revocation timing.
4. Minimum message-content retention and duration.

Only then ask Liz to choose the moderation path and privacy policy. The local hardening proposal is not production-ready and does not settle those choices.

## Already answered, do not resend

- Photo permission uses the existing submitter checkbox.
- Community and Organization are distinct: Community uses Join and members; Organization uses Follow and followers.
- Plan chat closes 48 hours later and remains accessible under Past.
- Creators explicitly choose open or approval-required for new Communities.
- Creator fee is 4 percent; the buyer sees the separate 2.9 percent processing fee.
- Friends and Pinned may be archived only after Your People is verified end to end.
- Circles remains on the roadmap.
- Multiple Circle Plans may run simultaneously.
- TestFlight agreement and access instructions, and the sub-activity question, have already been handled.

## Release boundary

Liz's product or copy approval does not authorize a commit, push, build, deploy, migration apply, flag activation, credential change, or production release. Each protected action still requires Josh's separate explicit approval.
