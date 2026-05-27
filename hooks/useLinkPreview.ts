import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Fetches link-preview metadata for a URL via the `og-unfurl` edge function and
// caches it in-memory for the session, so a message that scrolls in and out of
// view doesn't refetch. Fails soft: any error resolves to null and the caller
// renders no card. The card is dormant until og-unfurl is deployed to prod.
//
// Persistence (a `link_preview jsonb` column on messages, so previews survive a
// cold start and don't refetch per-device) is a deferred pre-flip optimization;
// the in-memory cache is enough for v1.

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

// url -> resolved preview (or null when there's nothing worth showing). A
// pending fetch is tracked separately so concurrent bubbles share one request.
const cache = new Map<string, LinkPreview | null>();
const inflight = new Map<string, Promise<LinkPreview | null>>();

function hasContent(p: LinkPreview | null): p is LinkPreview {
  return !!p && !!(p.title || p.description || p.image);
}

async function fetchPreview(url: string): Promise<LinkPreview | null> {
  if (cache.has(url)) return cache.get(url) ?? null;
  let promise = inflight.get(url);
  if (!promise) {
    promise = (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('og-unfurl', { body: { url } });
        const preview = error ? null : (data?.preview ?? null);
        const result = hasContent(preview) ? preview : null;
        cache.set(url, result);
        return result;
      } catch {
        cache.set(url, null);
        return null;
      } finally {
        inflight.delete(url);
      }
    })();
    inflight.set(url, promise);
  }
  return promise;
}

export function useLinkPreview(url: string | null): { preview: LinkPreview | null; loading: boolean } {
  const [preview, setPreview] = useState<LinkPreview | null>(() => (url ? cache.get(url) ?? null : null));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) { setPreview(null); setLoading(false); return; }
    if (cache.has(url)) { setPreview(cache.get(url) ?? null); setLoading(false); return; }

    let active = true;
    setLoading(true);
    fetchPreview(url).then((p) => {
      if (active) { setPreview(p); setLoading(false); }
    });
    return () => { active = false; };
  }, [url]);

  return { preview, loading };
}
