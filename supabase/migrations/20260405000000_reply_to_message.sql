-- Documentation-only. Applied directly in production on 2026-04-05.
-- Adds reply-to-message support for chat messages.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES messages(id) ON DELETE SET NULL;
