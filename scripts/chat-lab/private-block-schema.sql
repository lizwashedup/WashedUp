-- Local-only add-on for the existing disposable chat lab, never production.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.chat_lab_marker WHERE id='washedup-local-chat-lab-v1') THEN
  RAISE EXCEPTION 'Requires the disposable chat lab';
 END IF;
 IF to_regclass('public.messages') IS NOT NULL THEN
  RAISE EXCEPTION 'Private-message fixture already exists; do not replace it';
 END IF;
END $$;
CREATE TABLE public.private_chat_lab_marker(id text PRIMARY KEY CHECK(id='washedup-private-chat-lab-v1'));
INSERT INTO public.private_chat_lab_marker VALUES ('washedup-private-chat-lab-v1');
ALTER TABLE public.profiles ADD COLUMN blocked_users uuid[];
CREATE TABLE public.user_blocks(blocker_id uuid REFERENCES auth.users(id),blocked_id uuid REFERENCES auth.users(id),PRIMARY KEY(blocker_id,blocked_id));
CREATE TABLE public.circles(id uuid PRIMARY KEY,name text);
CREATE TABLE public.circle_members(circle_id uuid REFERENCES public.circles(id),user_id uuid REFERENCES auth.users(id),status text,PRIMARY KEY(circle_id,user_id));
CREATE TABLE public.messages(id uuid PRIMARY KEY,circle_id uuid REFERENCES public.circles(id),event_id uuid,user_id uuid REFERENCES auth.users(id),content text,created_at timestamptz DEFAULT now());
CREATE TABLE public.message_reactions(id uuid PRIMARY KEY,message_id uuid REFERENCES public.messages(id),user_id uuid REFERENCES auth.users(id),emoji text);
CREATE FUNCTION public.is_circle_member(p_circle_id uuid,p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.circle_members WHERE circle_id=p_circle_id AND user_id=p_user_id AND status='joined');
$$;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_read ON public.messages FOR SELECT TO authenticated USING(public.is_circle_member(circle_id,auth.uid()));
CREATE POLICY member_send ON public.messages FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND public.is_circle_member(circle_id,auth.uid()));
CREATE POLICY reaction_read ON public.message_reactions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.messages m WHERE m.id=message_id));
CREATE POLICY reaction_write ON public.message_reactions FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.messages m WHERE m.id=message_id));
GRANT SELECT ON public.private_chat_lab_marker TO service_role;
GRANT SELECT,INSERT ON public.messages,public.message_reactions TO authenticated;
GRANT ALL ON public.private_chat_lab_marker,public.profiles,public.user_blocks,public.circles,public.circle_members,public.messages,public.message_reactions TO service_role;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages, public.message_reactions;
COMMIT;
