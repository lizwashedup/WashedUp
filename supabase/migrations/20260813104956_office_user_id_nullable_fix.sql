-- Office scaffold Phase 3: growth_cards, investors, strategy_answers,
-- documents, and tools all carry a NOT NULL user_id column with no default
-- and no foreign key -- vestigial from a per-user template, not a real
-- constraint tied to anything (confirmed: no FK to auth.users, all 5 tables
-- empty in prod). The office scaffold is a single shared password-gated
-- tool (middleware.ts's wu_auth cookie), not multi-tenant, so nothing ever
-- sets this column. Left NOT NULL, every insert from the already-written
-- Growth/Investors/Strategy/Docs routes would 500 at runtime despite
-- passing tsc/eslint. Dropping NOT NULL is safe: no data exists yet, no FK
-- to break.

BEGIN;

ALTER TABLE growth_cards ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE investors ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE strategy_answers ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE documents ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE tools ALTER COLUMN user_id DROP NOT NULL;

COMMIT;
