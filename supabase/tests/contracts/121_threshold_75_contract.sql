\set ON_ERROR_STOP on

SET request.jwt.claim.role = 'service_role';
UPDATE public.ticket_orders
SET receipt_resend_last_requested_at = now()
WHERE id = '60000000-0000-0000-0000-000000000001';

SET ROLE authenticated;
SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
SET request.jwt.claim.role = 'authenticated';

UPDATE public.community_topic_messages
SET body = 'edited', edited_at = now()
WHERE id = '40000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  BEGIN
    UPDATE public.community_topic_messages
    SET topic_id = '30000000-0000-0000-0000-000000000002'
    WHERE id = '40000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'contract failed: topic move was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'contract failed: topic move was accepted' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO public.community_topic_messages(topic_id, sender_id, body, reply_to_message_id)
VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'same room reply', '40000000-0000-0000-0000-000000000001');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.community_topic_messages(topic_id, sender_id, body)
    VALUES ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'archived write');
    RAISE EXCEPTION 'contract failed: archived-topic message was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'contract failed: archived-topic message was accepted' THEN RAISE; END IF;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.community_topic_messages(topic_id, sender_id, body, reply_to_message_id)
    VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'cross room reply', '40000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'contract failed: cross-topic reply was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'contract failed: cross-topic reply was accepted' THEN RAISE; END IF;
  END;
END $$;

INSERT INTO public.community_topic_message_reactions(message_id, user_id, reaction)
VALUES ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'heart');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.community_topic_message_reactions(message_id, user_id, reaction)
    VALUES ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'heart');
    RAISE EXCEPTION 'contract failed: archived-topic reaction was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'contract failed: archived-topic reaction was accepted' THEN RAISE; END IF;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE public.community_topic_message_reactions
    SET message_id = '40000000-0000-0000-0000-000000000002'
    WHERE message_id = '40000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'contract failed: reaction move was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'contract failed: reaction move was accepted' THEN RAISE; END IF;
  END;
END $$;

UPDATE public.community_broadcasts
SET body = 'main thread edited', edited_at = now()
WHERE id = '50000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  BEGIN
    UPDATE public.community_broadcasts
    SET community_id = '20000000-0000-0000-0000-000000000002'
    WHERE id = '50000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'contract failed: community move was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'contract failed: community move was accepted' THEN RAISE; END IF;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE public.ticket_orders
    SET receipt_resend_last_requested_at = NULL
    WHERE id = '60000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'contract failed: buyer reset the receipt cooldown';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'contract failed: buyer reset the receipt cooldown' THEN RAISE; END IF;
  END;
END $$;

RESET ROLE;
SET ROLE service_role;
SET request.jwt.claim.role = 'service_role';
UPDATE public.ticket_orders
SET receipt_resend_last_requested_at = now()
WHERE id = '60000000-0000-0000-0000-000000000001';

RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'PASS: threshold 75 RLS and identity contracts'; END $$;
