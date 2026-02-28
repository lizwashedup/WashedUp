# Fix: Exclude Sender from New Message Push Notifications

**Issue:** Users receive push notifications for their own messages in group chat.

**Root cause:** The `notify_new_message()` trigger (or `send_expo_push()` logic) does not exclude the message sender when determining recipients.

**Fix:** Add a filter so the recipient's `user_id` does not equal the message sender's `user_id`.

## For Lovable / Database

In the `notify_new_message()` trigger function (or wherever recipients are selected for push), add:

```sql
AND user_id IS DISTINCT FROM NEW.user_id
```

to the WHERE clause that selects recipients. Or equivalently:

```sql
AND (user_id IS NULL OR user_id != NEW.user_id)
```

If the logic loops over `event_members`, filter out the sender:

```sql
WHERE em.event_id = NEW.event_id
  AND em.status = 'joined'
  AND em.user_id IS DISTINCT FROM NEW.user_id   -- exclude sender
```

If `send_expo_push()` is called with a list of user_ids, ensure the caller passes only recipients (excluding `NEW.user_id`).
