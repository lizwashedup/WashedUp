-- Two junk draft communities created by accident while Liz was stuck in the
-- setup loop today (2026-08-29). Both are drafts, nobody but her can see
-- them, safe to delete. Her real community (Liz's Community / liz-community)
-- is untouched by this.
--
-- liztesting / "StT"   -- id 610c1868-adcb-4d15-bdf8-245ab797f023
-- liz / "Liz"          -- id a7476e5b-5da5-4b79-b2c6-3d70fffd6187

delete from community_members
where community_id in (
  '610c1868-adcb-4d15-bdf8-245ab797f023',
  'a7476e5b-5da5-4b79-b2c6-3d70fffd6187'
);

delete from communities
where id in (
  '610c1868-adcb-4d15-bdf8-245ab797f023',
  'a7476e5b-5da5-4b79-b2c6-3d70fffd6187'
);
