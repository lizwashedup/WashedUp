-- Preempt the same FK-blocks-delete bug that hit messages.reply_to_message_id.
-- broadcasts.created_by and moderation_actions.performed_by both default to NO ACTION,
-- which would block deletion of any admin who had created a broadcast or performed a
-- moderation action. Both tables are currently empty in prod, but as soon as they're
-- populated the same delete bug returns. Switching to ON DELETE SET NULL preserves
-- the audit row while letting the referenced user be deleted.

ALTER TABLE public.broadcasts DROP CONSTRAINT broadcasts_created_by_fkey;
ALTER TABLE public.broadcasts ADD CONSTRAINT broadcasts_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.moderation_actions DROP CONSTRAINT moderation_actions_performed_by_fkey;
ALTER TABLE public.moderation_actions ADD CONSTRAINT moderation_actions_performed_by_fkey
  FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
