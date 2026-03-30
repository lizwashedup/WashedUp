-- Remove auto-reciprocal rows created by the old symmetric add_friend behavior.
-- Pairs where both directions share the same created_at were inserted in a single
-- transaction by the old RPC; neither user explicitly initiated both directions.
WITH symmetric_pairs AS (
  SELECT f1.id AS id1, f2.id AS id2
  FROM friends f1
  JOIN friends f2
    ON  f2.user_id    = f1.friend_id
    AND f2.friend_id  = f1.user_id
    AND f2.created_at = f1.created_at   -- same transaction = auto-created pair
  WHERE f1.user_id < f1.friend_id       -- enumerate each pair once
)
DELETE FROM friends
WHERE id IN (
  SELECT id1 FROM symmetric_pairs
  UNION ALL
  SELECT id2 FROM symmetric_pairs
);
