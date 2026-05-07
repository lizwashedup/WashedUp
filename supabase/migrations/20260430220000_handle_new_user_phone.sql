-- Add phone_number to the handle_new_user trigger so phone signups land
-- with phone_number already populated in profiles, instead of relying on
-- the fire-and-forget UPDATE in verify-code.tsx (which silently swallows
-- errors and could leave the user bouncing through migration-gate forever
-- if the sync fails).
--
-- NULLIF(NEW.phone, '') normalizes empty-string and NULL to NULL — Supabase
-- writes empty string in some auth setups, NULL in others, and we want a
-- clean NULL for the !phone_number check in authedDest().

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, first_name_display, onboarding_status, phone_number)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      SPLIT_PART(NEW.raw_user_meta_data->>'full_name', ' ', 1),
      SPLIT_PART(NEW.raw_user_meta_data->>'name', ' ', 1),
      SPLIT_PART(NEW.email, '@', 1)
    ),
    'pending',
    NULLIF(NEW.phone, '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;
