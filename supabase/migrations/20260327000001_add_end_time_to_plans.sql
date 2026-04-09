-- Add end_time column to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time timestamptz;

-- Set launch party end time: March 29 2026, 9 PM PDT (UTC-7 → 04:00 UTC March 30)
UPDATE events
SET end_time = '2026-03-30T04:00:00Z'
WHERE id = 'c7acdfab-e775-4b27-b70c-fe503bb71589';
