-- Fix delete_own_account failure: replies to a deleted user's messages
-- were blocking deletion via the self-referential FK on messages.reply_to_message_id.
-- Switching to ON DELETE SET NULL lets a reply outlive its parent (becomes a regular message).

ALTER TABLE public.messages DROP CONSTRAINT messages_reply_to_message_id_fkey;
ALTER TABLE public.messages ADD CONSTRAINT messages_reply_to_message_id_fkey
  FOREIGN KEY (reply_to_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;
