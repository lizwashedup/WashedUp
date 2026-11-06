import { compareChatTimestamps } from './chatTimestamp';

type Candidate = {
  id: string;
  at: string;
  current: () => boolean;
  visible: () => boolean;
  write: () => Promise<boolean>;
};

// One queue per account, conversation and history window. An older page may
// be visible while a newer socket arrival is below it; keep those separate.
export function createMemberChatReadQueue() {
  let page: (Candidate & { startedAfter: number }) | null = null;
  const arrivals = new Map<string, Candidate>();
  let sending: Candidate | null = null;
  let stamp: string | null = null;
  let completions = 0;
  let burst: ReturnType<typeof setTimeout> | null = null;

  function drain(flushLive = false) {
    if (sending) return;
    if (page && (!page.current() || compareChatTimestamps(page.at, stamp) < 0 ||
        (compareChatTimestamps(page.at, stamp) === 0 && page.startedAfter < completions))) page = null;
    const fromPage = page?.visible() ? page : null;
    let fromLive: Candidate | null = null;
    for (const [id, row] of arrivals) {
      if (!row.current() || compareChatTimestamps(row.at, stamp) <= 0) arrivals.delete(id);
      else if ((!fromLive || compareChatTimestamps(row.at, fromLive.at) > 0) && row.visible()) fromLive = row;
    }
    const next = fromLive && (!fromPage || compareChatTimestamps(fromLive.at, fromPage.at) > 0) ? fromLive : fromPage;
    if (!next) return;
    if (next === fromLive && !flushLive && !fromPage) {
      // Several arrivals can become visible together. Only the newest
      // confirmed position needs a write. Recheck visibility at dispatch.
      if (!burst) burst = setTimeout(() => { burst = null; drain(true); }, 200);
      return;
    }
    if (next === page) page = null;
    arrivals.delete(next.id);
    sending = next;
    void next.write().then(confirmed => {
      if (confirmed) { stamp = next.at; completions++; }
    }).finally(() => { sending = null; drain(); });
  }
  return {
    beginPage() { page = null; return completions; },
    offerPage(candidate: Candidate, startedAfter: number) { page = { ...candidate, startedAfter }; drain(); },
    offerLive(candidate: Candidate) {
      if (!candidate.current() || compareChatTimestamps(candidate.at, stamp) <= 0 ||
          (sending?.current() && compareChatTimestamps(candidate.at, sending.at) <= 0) || arrivals.has(candidate.id)) return;
      arrivals.set(candidate.id, candidate);
      if (candidate.visible()) drain();
    },
    check: () => drain(),
    forget(id: string) { arrivals.delete(id); if (page?.id === id) page = null; },
    clear() { page = null; arrivals.clear(); if (burst) clearTimeout(burst); burst = null; },
  };
}
