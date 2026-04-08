-- Add 'referral' value to the onboarding_status enum so the new
-- "How did you hear about us?" onboarding step can persist progress.
-- Already applied to production via dashboard on 2026-04-08; this file
-- exists so the schema is reproducible from migrations alone.

ALTER TYPE public.onboarding_status ADD VALUE IF NOT EXISTS 'referral' AFTER 'la_check';
