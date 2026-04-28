-- Signup-time ban enforcement.
-- Adds a BEFORE INSERT trigger on auth.users that checks banned_identifiers
-- against (normalized email, apple_sub, email substring patterns) and aborts
-- the signup with RAISE EXCEPTION on match. handle_new_user is NOT modified.
--
-- Also adds the photo_hash column + helper functions used by an upcoming
-- photo-upload-time check. The signup trigger does NOT consult photo_hash
-- (no photo at signup time).

CREATE OR REPLACE FUNCTION public.normalize_email(addr text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE local_part text; domain_part text;
BEGIN
  IF addr IS NULL THEN RETURN NULL; END IF;
  addr := lower(trim(addr));
  local_part := split_part(addr, '@', 1);
  domain_part := split_part(addr, '@', 2);
  IF domain_part IN ('gmail.com', 'googlemail.com') THEN
    local_part := split_part(local_part, '+', 1);
    local_part := replace(local_part, '.', '');
    RETURN local_part || '@gmail.com';
  END IF;
  RETURN addr;
END $$;

ALTER TABLE banned_identifiers
  ADD COLUMN IF NOT EXISTS normalized_email text,
  ADD COLUMN IF NOT EXISTS email_pattern text,
  ADD COLUMN IF NOT EXISTS photo_hash text;

CREATE OR REPLACE FUNCTION public.banned_identifiers_set_normalized()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.normalized_email := public.normalize_email(NEW.email); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS banned_identifiers_normalize ON banned_identifiers;
CREATE TRIGGER banned_identifiers_normalize
  BEFORE INSERT OR UPDATE ON banned_identifiers
  FOR EACH ROW EXECUTE FUNCTION public.banned_identifiers_set_normalized();

UPDATE banned_identifiers
SET normalized_email = public.normalize_email(email)
WHERE email IS NOT NULL AND normalized_email IS NULL;

INSERT INTO banned_identifiers (email_pattern, reason, banned_at)
VALUES ('%akshitbajaj%', 'Substring pattern for repeat ban evader (Akshit)', now());

INSERT INTO banned_identifiers (photo_hash, reason, banned_at)
VALUES ('993924cee6d29939132ea7f16686cc9996d15e8cd034a6a75f591263acccc766',
        'pHash of Akshit profile photo (256-bit, identical across both accounts)', now());

CREATE INDEX IF NOT EXISTS banned_identifiers_normalized_email_idx
  ON banned_identifiers (normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS banned_identifiers_apple_sub_idx
  ON banned_identifiers (apple_sub) WHERE apple_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS banned_identifiers_photo_hash_idx
  ON banned_identifiers (photo_hash) WHERE photo_hash IS NOT NULL;

-- Hamming distance on two 64-char hex strings (256-bit pHash).
-- bytea cannot be cast directly to bit, so we loop the 32 bytes and
-- bit_count(byte_a XOR byte_b) for each.
CREATE OR REPLACE FUNCTION public.phash_distance_256(a text, b text)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  ba bytea;
  bb bytea;
  i int;
  total int := 0;
BEGIN
  IF a IS NULL OR b IS NULL OR length(a) <> 64 OR length(b) <> 64 THEN
    RETURN 256;
  END IF;
  ba := decode(a, 'hex');
  bb := decode(b, 'hex');
  FOR i IN 0..31 LOOP
    total := total + bit_count((get_byte(ba, i) # get_byte(bb, i))::bit(8))::int;
  END LOOP;
  RETURN total;
END $$;

CREATE OR REPLACE FUNCTION public.is_photo_banned(hash text, threshold int DEFAULT 8)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM banned_identifiers
    WHERE photo_hash IS NOT NULL
      AND public.phash_distance_256(photo_hash, hash) <= threshold
  );
$$;

CREATE OR REPLACE FUNCTION public.check_banned_at_signup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE norm_email text; apple_sub_v text;
BEGIN
  norm_email  := public.normalize_email(NEW.email);
  apple_sub_v := NEW.raw_user_meta_data->>'sub';

  IF norm_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.banned_identifiers WHERE normalized_email = norm_email
  ) THEN
    RAISE EXCEPTION 'signup_blocked'
      USING ERRCODE = 'check_violation', HINT = 'Email is on the WashedUp ban list.';
  END IF;

  IF apple_sub_v IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.banned_identifiers WHERE apple_sub = apple_sub_v
  ) THEN
    RAISE EXCEPTION 'signup_blocked'
      USING ERRCODE = 'check_violation', HINT = 'Apple account is on the WashedUp ban list.';
  END IF;

  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.banned_identifiers
    WHERE email_pattern IS NOT NULL AND lower(NEW.email) LIKE lower(email_pattern)
  ) THEN
    RAISE EXCEPTION 'signup_blocked'
      USING ERRCODE = 'check_violation', HINT = 'Email matches a ban pattern.';
  END IF;

  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM banned_identifiers
                 WHERE normalized_email = normalize_email('info.akshitbajaj@gmail.com'))
  THEN RAISE EXCEPTION 'TEST FAIL: exact akshit email not banned'; END IF;

  IF NOT EXISTS (SELECT 1 FROM banned_identifiers
                 WHERE normalized_email = normalize_email('infoakshitbajaj@gmail.com'))
  THEN RAISE EXCEPTION 'TEST FAIL: dot-stripped variant not detected'; END IF;

  IF NOT EXISTS (SELECT 1 FROM banned_identifiers
                 WHERE normalized_email = normalize_email('info.akshit.bajaj+washedup@gmail.com'))
  THEN RAISE EXCEPTION 'TEST FAIL: +alias variant not detected'; END IF;

  IF NOT EXISTS (SELECT 1 FROM banned_identifiers
                 WHERE email_pattern IS NOT NULL
                   AND lower('AkshitBajaj99@gmail.com') LIKE lower(email_pattern))
  THEN RAISE EXCEPTION 'TEST FAIL: substring pattern miss'; END IF;

  IF NOT EXISTS (SELECT 1 FROM banned_identifiers
                 WHERE apple_sub = '000178.ecbdda4289aa4b43ac0bf22a86477587.2349')
  THEN RAISE EXCEPTION 'TEST FAIL: original apple_sub not banned'; END IF;

  IF EXISTS (SELECT 1 FROM banned_identifiers
             WHERE normalized_email = normalize_email('liz@washedup.app'))
     OR EXISTS (SELECT 1 FROM banned_identifiers
                WHERE email_pattern IS NOT NULL
                  AND lower('liz@washedup.app') LIKE lower(email_pattern))
  THEN RAISE EXCEPTION 'TEST FAIL: liz@washedup.app falsely flagged'; END IF;

  IF NOT public.is_photo_banned('993924cee6d29939132ea7f16686cc9996d15e8cd034a6a75f591263acccc766')
  THEN RAISE EXCEPTION 'TEST FAIL: Akshit photo hash not detected'; END IF;

  IF public.is_photo_banned('0000000000000000000000000000000000000000000000000000000000000000')
  THEN RAISE EXCEPTION 'TEST FAIL: clean photo hash falsely flagged'; END IF;

  RAISE NOTICE 'All ban-detection tests passed';
END $$;

DROP TRIGGER IF EXISTS auth_users_check_banned ON auth.users;
CREATE TRIGGER auth_users_check_banned
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.check_banned_at_signup();
