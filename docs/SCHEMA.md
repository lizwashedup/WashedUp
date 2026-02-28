# WashedUp — Supabase Schema Reference
> Project ref: uwjhbfxragjyvylciwrb
> Supabase URL: https://uwjhbfxragjyvylciwrb.supabase.co
> Last updated from Lovable backend export.

---

## Enums

| Enum | Values |
|---|---|
| `event_status` | `forming`, `active`, `full`, `completed`, `cancelled`, `draft` |
| `gender_rule` | `women_only`, `men_only`, `mixed`, `nonbinary_only` |
| `gender_type` | `woman`, `man`, `non_binary` |
| `member_role` | `host`, `guest` |
| `member_status` | `joined`, `left`, `removed` — **no `waitlist`** |
| `message_type` | `user`, `system` |
| `onboarding_status` | `pending`, `complete` |

---

## `events`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `creator_user_id` | uuid | FK → `profiles.id` (`events_creator_user_id_fkey`) |
| `title` | text | |
| `description` | text | nullable |
| `host_message` | text | nullable — host's personal note to the group |
| `location_text` | text | nullable |
| `location_place_id` | text | nullable — Google Place ID |
| `location_lat` | numeric | nullable — **NOT** `latitude` |
| `location_lng` | numeric | nullable — **NOT** `longitude` |
| `start_time` | timestamptz | |
| `status` | event_status | default `forming` |
| `member_count` | integer | **maintained by DB trigger — never manually update** |
| `max_invites` | integer | default 5 |
| `min_invites` | integer | default 2 |
| `gender_rule` | gender_rule | **NOT** `gender_preference` |
| `target_age_min` | integer | nullable |
| `target_age_max` | integer | nullable |
| `primary_vibe` | text | nullable — **NOT** `category` |
| `city` | text | nullable |
| `image_url` | text | nullable |
| `tickets_url` | text | nullable |
| `invite_locked` | boolean | default true |
| `is_featured` | boolean | default false |
| `explore_event_id` | uuid | nullable, FK → `explore_events.id` |
| `created_at` / `updated_at` | timestamptz | |

**Live statuses** (shown in feed): `forming`, `active`, `full`
**Auto-completed** 5h after `start_time` via `auto_complete_past_events()`

---

## `profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK — from `auth.users` via `handle_new_user` trigger |
| `email` | text | nullable |
| `first_name_display` | text | nullable — **NOT** `first_name` |
| `profile_photo_url` | text | nullable — **NOT** `avatar_url` |
| `bio` | text | nullable |
| `birthday` | date | nullable |
| `gender` | gender_type | nullable — **NOT** `gender_type` |
| `vibe_tags` | text[] | default `'{}'` |
| `city` | text | nullable |
| `onboarding_status` | onboarding_status | default `pending` |
| `blocked_users` | uuid[] | default `'{}'` |
| `phone_number` / `phone_verified` | text / bool | |
| `handle` | text | nullable, UNIQUE — @handle for search/share (2-20 chars, lowercase alphanumeric + _) |
| `instagram_handle` / `linkedin_url` / `tiktok_handle` | text | nullable |
| `is_in_la` | boolean | nullable |
| `push_new_messages` / `push_someone_joins` / `push_new_plans_area` | boolean | default true |
| `last_active_at` / `created_at` / `updated_at` | timestamptz | |

⚠️ **Use `profiles_public` view** when displaying another user's info — no PII (no email/phone exposed).

---

## `profiles_public` (VIEW)

Safe subset of `profiles` for displaying other users. Use this for member lists, host info, etc.
Fields: `id`, `first_name_display`, `profile_photo_url`, `bio`, `vibe_tags`, `city`, `gender`, `handle`, `instagram_handle`, `linkedin_url`, `tiktok_handle`

---

## `friends`

Symmetric social graph (Your People). When A adds B, both rows exist.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → profiles.id |
| `friend_id` | uuid | FK → profiles.id |
| `created_at` | timestamptz | |

UNIQUE(user_id, friend_id). RLS: users can only see/add/delete their own rows.
Use RPCs `add_friend(p_friend_id)` and `remove_friend(p_friend_id)` for symmetric add/remove.

---

## `event_members`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → `events.id` |
| `user_id` | uuid | FK → `profiles.id` |
| `role` | member_role | `host` or `guest` — **required on insert** |
| `status` | member_status | `joined`, `left`, `removed` |
| `joined_at` | timestamptz | |
| `age_at_join` | integer | nullable |
| `gender_at_join` | text | nullable |
| `confirmation_status` | text | default `pending` |

**Insert on join:** `{ event_id, user_id, role: 'guest', status: 'joined' }`

---

## `messages`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `event_id` | uuid | FK → `events.id` |
| `user_id` | uuid | nullable, FK → `profiles.id` |
| `content` | text | |
| `image_url` | text | nullable |
| `message_type` | message_type | `user` or `system` |
| `reply_to_message_id` | uuid | nullable, self-FK |
| `created_at` | timestamptz | |

**Realtime enabled** — subscribe via `postgres_changes` on `messages` for live chat.

---

## `chat_reads`

Tracks last-read timestamp per user per event — used for unread message badges.

---

## `message_likes`

Likes on individual chat messages.

---

## `wishlists`

| Column | Notes |
|---|---|
| `id` | PK |
| `user_id` | FK → `profiles.id` |
| `event_id` | FK → `events.id` |
| `created_at` | |

Unique constraint on `(user_id, event_id)`. RLS: users can only see/add/delete their own rows.

---

## `event_waitlist`

Users join when a plan is full; they get notified (via push/backend) when a spot opens. **Do not auto-join** — just notify.

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `event_id` | FK → `events.id` |
| `user_id` | FK → `profiles.id` |
| `created_at` | timestamptz |
| `notified` | boolean, default false — set true after push sent |

Unique constraint on `(event_id, user_id)`. RLS: users can view/add/remove their own rows only.

**Trigger:** When someone leaves a plan (status → `left`) and a spot opens, rows are inserted into `waitlist_notification_queue`. An edge function/cron should process the queue, send push notifications, and set `notified = true`.

---

## `waitlist_notification_queue`

Queue for waitlist notifications. Trigger populates when a spot opens. Edge function/cron processes: send push via `expo_push_token` on profiles, then `UPDATE event_waitlist SET notified = true` and delete from queue.

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `event_id` | FK → `events.id` |
| `user_id` | FK → `profiles.id` |
| `created_at` | timestamptz |

---

## `explore_events`

Curated "Ideas" feed. Filter by `status = 'Live'`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `title` | text | |
| `description` | text | nullable |
| `image_url` | text | nullable |
| `event_date` or `date` | date/text | nullable — event date |
| `start_time` or `time` | text | nullable — time (e.g. "19:00") |
| `venue` | text | nullable |
| `venue_address` | text | nullable |
| `category` | text | nullable |
| `external_url` | text | nullable |
| `ticket_price` | text | nullable |
| `status` | text | filter `Live` |

---

## Storage Buckets (all public)

| Bucket | Path pattern |
|---|---|
| `profile-photos` | `{user_id}/{timestamp}.png` |
| `event-images` | any path |
| `chat-images` | any path |

Public URL: `https://uwjhbfxragjyvylciwrb.supabase.co/storage/v1/object/public/{bucket}/{path}`

---

## RPCs

| Function | Use |
|---|---|
| `get_filtered_feed(p_user_id)` | **USE THIS for the plans feed** — filters by gender_rule, age, blocked users automatically |
| `get_event_members_reveal(p_event_id)` | Member details with profile info (caller must be a member) |
| `can_join_event_gender(p_user_id, p_event_id)` | Gender eligibility check before joining |
| `get_total_user_count()` | Public user count |
| `calculate_age(birthday)` / `get_age_group(birthday)` | Age helpers |
| `update_activity_tracking(p_user_id, p_now, p_is_return_day)` | Activity tracking |
| `handle_new_user()` | Trigger: creates profile on auth signup |
| `validate_profile_data()` | Trigger: validates profile on update |
| `is_admin(user_id)` / `has_role(user_id, role)` | Auth helpers |
| `is_identifier_banned(email, phone)` | Ban check |

---

## RLS Summary

| Table | Rules |
|---|---|
| `profiles` | Own row only for read/update |
| `events` | Publicly readable; only creator can edit/delete |
| `event_members` | Members can read their event's members; must be a member to insert |
| `messages` | Must be a joined member to read or send |
| `wishlists` | Own rows only |

---

## Common Column Name Mistakes

| Wrong | Correct |
|---|---|
| `gender_preference` | `gender_rule` |
| `gender_type` (on profiles) | `gender` |
| `latitude` / `longitude` | `location_lat` / `location_lng` |
| `age_range` | `target_age_min` / `target_age_max` |
| `category` | `primary_vibe` |
| `first_name` | `first_name_display` |
| `avatar_url` | `profile_photo_url` |
| `host_id` | `creator_user_id` |
| `event_members(count)` | `member_count` column directly on events |

---

## Auth

- `supabase.auth.signUp({ email, password })`
- `supabase.auth.signInWithPassword({ email, password })`
- Profile auto-created by `handle_new_user` trigger on signup
- `onboarding_status` starts as `pending` → set to `complete` after name/gender/birthday/photo filled
