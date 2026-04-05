-- Documentation-only. Applied directly in production on 2026-04-04.
-- Change: one reaction per person per message (not per person per emoji).
-- If a user reacts with a different emoji, it replaces their previous reaction.

-- Drop the old constraint (message_id, user_id, reaction)
ALTER TABLE message_reactions
  DROP CONSTRAINT IF EXISTS message_reactions_message_id_user_id_reaction_key;

-- Add new constraint (message_id, user_id) — one reaction per person per message
ALTER TABLE message_reactions
  ADD CONSTRAINT message_reactions_message_id_user_id_key
  UNIQUE (message_id, user_id);
