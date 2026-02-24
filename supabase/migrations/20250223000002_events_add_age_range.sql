-- Add age_range column to events table for the Post a Plan feature.
-- Run in Supabase SQL Editor before testing plan creation.

ALTER TABLE events ADD COLUMN IF NOT EXISTS age_range TEXT DEFAULT 'All Ages';
