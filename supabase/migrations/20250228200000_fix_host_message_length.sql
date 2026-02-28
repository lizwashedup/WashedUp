-- Fix events_host_message_length: app allows 150 chars, ensure DB matches
-- Run in Supabase SQL Editor if you get "violates check constraint events_host_message_length"

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_host_message_length;

ALTER TABLE events ADD CONSTRAINT events_host_message_length
  CHECK (host_message IS NULL OR char_length(host_message) <= 150);
