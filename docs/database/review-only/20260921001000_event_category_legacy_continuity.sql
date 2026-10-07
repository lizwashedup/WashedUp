-- LOCAL / REVIEW ONLY. Requires 20260919133000_event_categories.sql.
-- Keep newer category lists coherent when an older client edits only category.
-- No backfill, policy, grant, existing RPC or financial field changes.
BEGIN;

CREATE FUNCTION public.guard_event_category_continuity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected text[]; primary_category text; second_category text; legacy text; legacy_write boolean:=false;
BEGIN
  -- Older records and inserts retain their original single-category storage.
  IF cardinality(NEW.categories)=0 THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    legacy:=OLD.category;
    legacy_write:=NEW.categories IS NOT DISTINCT FROM OLD.categories;
  END IF;
  IF legacy_write
      AND NEW.category IS DISTINCT FROM OLD.category THEN
    primary_category:=lower(btrim(NEW.category));
    IF NEW.community_id IS NOT NULL THEN
      IF primary_category='community' THEN
        selected:=ARRAY['community']||ARRAY(SELECT c FROM unnest(OLD.categories)c WHERE c<>'community' LIMIT 1);
      ELSE selected:=ARRAY[primary_category,'community']; END IF;
    ELSE
      second_category:=OLD.categories[2];
      selected:=ARRAY[primary_category];
      IF second_category IS NOT NULL AND second_category IS DISTINCT FROM primary_category THEN
        selected:=array_append(selected,second_category);
      END IF;
    END IF;
  ELSE selected:=NEW.categories;
  END IF;
  NEW.categories:=public.validate_event_categories(selected,NEW.community_id IS NOT NULL,legacy);
  -- An older caller's exact primary value is part of its saved receipt. Keep
  -- that value/casing while adding the required Community tag to its list.
  IF NOT legacy_write THEN NEW.category:=NEW.categories[1]; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_event_category_continuity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_category_continuity BEFORE INSERT OR UPDATE OF category,categories,community_id
  ON public.explore_events FOR EACH ROW EXECUTE FUNCTION public.guard_event_category_continuity();

COMMIT;
