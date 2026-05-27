import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout.ts';

// Unfurls an arbitrary external URL pasted into a chat message into link-preview
// metadata (title / description / image / site name). This is NOT the og-* set,
// which renders OG images for WashedUp's OWN shareable content; this fetches and
// parses a third-party page. Because it fetches user-supplied URLs it guards
// against SSRF (scheme + host allow-listing) and caps how much HTML it reads.

const MAX_HTML_BYTES = 512 * 1024; // 512KB of HTML is plenty for <head> meta tags
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;
// A browser-ish UA: many sites serve no OG tags (or 403) to unknown agents.
const USER_AGENT =
  'Mozilla/5.0 (compatible; WashedUpBot/1.0; +https://washedup.app)';

interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

// Block obvious SSRF targets. Edge runtime can't cheaply DNS-resolve, so this is
// a best-effort host filter: reject non-http(s), loopback, link-local, private
// ranges, and bare hostnames with no dot (internal service names).
function isSafePublicUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  if (!host.includes('.') && !host.includes(':')) return null; // bare internal name
  // IPv4 private / loopback / link-local ranges
  if (/^127\./.test(host)) return null;
  if (/^10\./.test(host)) return null;
  if (/^192\.168\./.test(host)) return null;
  if (/^169\.254\./.test(host)) return null;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return null;
  if (host === '0.0.0.0') return null;
  // IPv6 loopback / link-local / unique-local
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return null;
  return u;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

// Find a meta tag's content by property/name, tolerant of attribute order and
// single/double quotes.
function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*?content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${k}["']`, 'i'),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]) return decodeEntities(m[1].trim());
    }
  }
  return null;
}

// Follow redirects MANUALLY, re-validating each hop's target against the SSRF
// guard. With fetch's default redirect:'follow', an allowed public URL could
// 30x-bounce to an internal address (e.g. cloud metadata 169.254.169.254) and
// the host check would never re-run on the redirect target. Residual gap:
// DNS rebinding (we validate the hostname string, not the resolved IP) — the
// edge runtime can't cheaply resolve+pin an IP, so that's accepted for v1.
async function safeFetch(start: URL): Promise<Response | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchWithTimeout(current.toString(), {
      timeoutMs: FETCH_TIMEOUT_MS,
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      res.body?.cancel().catch(() => {});
      if (!loc) return null;
      let next: URL;
      try { next = new URL(loc, current); } catch { return null; }
      const safe = isSafePublicUrl(next.toString());
      if (!safe) return null;
      current = safe;
      continue;
    }
    return res;
  }
  return null; // too many redirects
}

function parsePreview(html: string, finalUrl: string): LinkPreview {
  const title =
    metaContent(html, ['og:title', 'twitter:title']) ??
    (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
      ? decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)![1].trim())
      : null);
  const description = metaContent(html, ['og:description', 'twitter:description', 'description']);
  let image = metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
  const siteName = metaContent(html, ['og:site_name']);

  // Resolve a relative image URL against the page.
  if (image && !/^https?:\/\//i.test(image)) {
    try { image = new URL(image, finalUrl).toString(); } catch { image = null; }
  }
  return { url: finalUrl, title, description, image, siteName };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    let raw: string | null = null;
    if (req.method === 'POST') {
      raw = (await req.json().catch(() => ({})))?.url ?? null;
    } else {
      raw = new URL(req.url).searchParams.get('url');
    }
    if (!raw || typeof raw !== 'string') return json({ error: 'missing url' }, 400);

    // Normalize a bare www.* into https://
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const safe = isSafePublicUrl(normalized);
    if (!safe) return json({ error: 'unsupported url' }, 400);

    const res = await safeFetch(safe);
    if (!res || !res.ok) return json({ error: 'fetch failed' }, 502);

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) {
      // Non-HTML (e.g. a direct image/pdf link): no meta to parse.
      return json({ preview: { url: safe.toString(), title: null, description: null, image: null, siteName: null } });
    }

    // Read at most MAX_HTML_BYTES so a huge page can't exhaust memory.
    const reader = res.body?.getReader();
    let html = '';
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      while (received < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break; // meta tags live in <head>; stop early
      }
      html += decoder.decode(); // flush any bytes held back across the last chunk boundary
      reader.cancel().catch(() => {});
    } else {
      html = (await res.text()).slice(0, MAX_HTML_BYTES);
    }

    return json({ preview: parsePreview(html, res.url || safe.toString()) });
  } catch (_err) {
    return json({ error: 'unfurl error' }, 500);
  }
});
