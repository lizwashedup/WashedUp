-- Applied directly in production 2026-08-14 (documentation, matching this
-- repo's existing convention for direct-SQL changes). The 2026-04-04 file
-- claiming this same fix was "already applied" was wrong: verified live
-- tonight the old UNIQUE(message_id, user_id, reaction) constraint was still
-- active, meaning the original April fix never actually landed. Cleaned up
-- the 1 real duplicate group (2 stray rows, kept the newest by created_at)
-- before adding the constraint, since the old bug had let it accumulate.
-- Both client call sites (WashedUp/hooks/useChat.ts and useChatEngine.ts
-- toggleReaction) already do delete-if-same / update-if-different / insert-
-- if-none, so no app change was needed, this only closes a race-condition
-- window where two concurrent inserts could both land.

DELETE FROM message_reactions
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY message_id, user_id ORDER BY created_at DESC, id DESC) AS rn
    FROM message_reactions
  ) s WHERE rn > 1
);

ALTER TABLE message_reactions
  DROP CONSTRAINT IF EXISTS message_reactions_message_id_user_id_reaction_key;

ALTER TABLE message_reactions
  ADD CONSTRAINT message_reactions_message_id_user_id_key
  UNIQUE (message_id, user_id);
