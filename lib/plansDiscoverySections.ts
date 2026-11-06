import type { Plan } from './fetchPlans';
import type { CategoryOption } from '../constants/Categories';

export interface SectionDef {
  key: string;
  title: string;
  from: Date;
  to: Date;
}

// ─── Section boundary logic ───────────────────────────────────────────────────

export function getSectionDefs(now: Date): SectionDef[] {
  const day = now.getDay();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  const sections: SectionDef[] = [];

  const todayEnd = new Date(y, mo, d, 23, 59, 59, 999);
  // Widen the today bucket back 3h so happening-now plans (start_time in
  // the last 3h) land in it instead of falling through the section filter
  // at line ~192. The RPC caps past plans at 3h so this won't pull in
  // anything older than that.
  //
  // Title flips on local-time hour: morning + early afternoon say "Today"
  // (a 9 AM plan under "Tonight" at 11 AM was confusing real users). 4 PM
  // onward keeps the original "Tonight" framing for evening plans.
  const tonightFrom = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const todayTitle = now.getHours() < 16 ? 'Today' : 'Tonight';
  sections.push({ key: 'tonight', title: todayTitle, from: tonightFrom, to: todayEnd });

  if (day >= 1 && day <= 4) {
    const tomorrowStart = new Date(y, mo, d + 1, 0, 0, 0);
    // "This Week" ends Friday at 3:59:59.999 PM — Friday plans starting at/after
    // 4:00 PM belong to "This Weekend" instead.
    const fridayWeekEnd = new Date(y, mo, d + (5 - day), 15, 59, 59, 999);
    sections.push({ key: 'this-week', title: 'This Week', from: tomorrowStart, to: fridayWeekEnd });
  }

  if (day >= 1 && day <= 4) {
    const daysToFri = 5 - day;
    // "This Weekend" starts Friday at 4:00 PM so Friday plans don't double-bucket.
    const friWeekendStart = new Date(y, mo, d + daysToFri, 16, 0, 0, 0);
    const sunEnd = new Date(y, mo, d + daysToFri + 2, 23, 59, 59, 999);
    sections.push({ key: 'this-weekend', title: 'This Weekend', from: friWeekendStart, to: sunEnd });
  } else if (day === 5) {
    const satStart = new Date(y, mo, d + 1, 0, 0, 0);
    const sunEnd = new Date(y, mo, d + 2, 23, 59, 59, 999);
    sections.push({ key: 'this-weekend', title: 'This Weekend', from: satStart, to: sunEnd });
  } else if (day === 6) {
    const sunStart = new Date(y, mo, d + 1, 0, 0, 0);
    const sunEnd = new Date(y, mo, d + 1, 23, 59, 59, 999);
    sections.push({ key: 'this-weekend', title: 'This Weekend', from: sunStart, to: sunEnd });
  }

  const daysToNextMon = day === 0 ? 1 : (8 - day);
  const nextMonStart = new Date(y, mo, d + daysToNextMon, 0, 0, 0);
  const nextFriEnd = new Date(y, mo, d + daysToNextMon + 4, 23, 59, 59, 999);
  sections.push({ key: 'next-week', title: 'Next Week', from: nextMonStart, to: nextFriEnd });

  const comingUpStart = new Date(nextFriEnd.getTime() + 1);
  sections.push({ key: 'coming-up', title: 'Coming Up', from: comingUpStart, to: new Date(y + 2, 0, 1) });

  return sections;
}

// ─── Feed item grouping (clusters of duplicated plans) ───────────────────────

export type FeedItem =
  | { kind: 'standalone'; plan: Plan }
  | { kind: 'cluster'; rootId: string; plans: Plan[] };

function feedItemSpotsRemaining(p: Plan): number {
  return (p.max_invites ?? 0) + 1 - (p.member_count ?? 0);
}

function feedItemSortTime(item: FeedItem): string {
  if (item.kind === 'standalone') return item.plan.start_time;
  // Cluster slots in by its EARLIEST member so it appears at the same point
  // a single member would have in the chronological feed.
  return item.plans.reduce(
    (min, p) => (new Date(p.start_time) < new Date(min) ? p.start_time : min),
    item.plans[0].start_time,
  );
}

function feedItemMatchesCategory(item: FeedItem, filter: CategoryOption[]): boolean {
  if (filter.length === 0) return true;
  const lower = filter.map((c) => c.toLowerCase());
  if (item.kind === 'standalone') {
    return !!item.plan.category && lower.includes(item.plan.category.toLowerCase());
  }
  return item.plans.some((p) => p.category && lower.includes(p.category.toLowerCase()));
}

// Bucket plans into FeedItems by cluster_root_id. The RPC guarantees a
// non-null cluster_root_id only when ≥2 visible rows share the lineage,
// but client-side filters (day filter, !is_featured, etc.) run AFTER the
// RPC and can reduce a cluster back to 1 visible member. We re-collapse
// any 1-member cluster into a standalone here so the "popular plan"
// header never sits over a single card.
export function groupIntoFeedItems(plans: Plan[]): FeedItem[] {
  // Plain record instead of Map<...> because the file imports `Map` from
  // lucide-react-native (an icon component) which shadows the global type.
  const clusters: Record<string, Plan[]> = {};
  const items: FeedItem[] = [];
  for (const p of plans) {
    if (p.cluster_root_id) {
      if (!clusters[p.cluster_root_id]) clusters[p.cluster_root_id] = [];
      clusters[p.cluster_root_id].push(p);
    } else {
      items.push({ kind: 'standalone', plan: p });
    }
  }
  for (const rootId of Object.keys(clusters)) {
    const members = clusters[rootId];
    // Most spots first (leftmost), full plans last.
    members.sort((a, b) => feedItemSpotsRemaining(b) - feedItemSpotsRemaining(a));

    // Cap each creator at one card, preserving the cluster's existing sort
    // priority by keeping the first plan encountered for each creator id.
    const seenCreatorIds = new Set<string>();
    const cappedMembers = members.filter((plan) => {
      const creatorId = plan.creator?.id;
      if (!creatorId) return true;
      if (seenCreatorIds.has(creatorId)) return false;
      seenCreatorIds.add(creatorId);
      return true;
    });

    if (cappedMembers.length < 2) {
      // Cluster collapsed to 1 by client-side filters or the creator cap —
      // render as a normal standalone card with no "popular plan" header.
      items.push({ kind: 'standalone', plan: cappedMembers[0] });
      continue;
    }
    items.push({ kind: 'cluster', rootId, plans: cappedMembers });
  }
  // Final chronological pass: clusters slot in by their earliest member's
  // start_time, interleaved with standalones — otherwise clusters all bunch
  // at the end of insertion order regardless of when their plans actually are.
  items.sort(
    (a, b) =>
      new Date(feedItemSortTime(a)).getTime() -
      new Date(feedItemSortTime(b)).getTime(),
  );
  return items;
}

export function filterIntoSections(
  items: FeedItem[],
  sectionDefs: SectionDef[],
  categoryFilter: CategoryOption[],
  whenKeys: string[],
): { def: SectionDef; items: FeedItem[] }[] {
  const catFiltered = items.filter((i) => feedItemMatchesCategory(i, categoryFilter));

  return sectionDefs
    .filter((def) => whenKeys.length === 0 || whenKeys.includes(def.key))
    .map((def) => ({
      def,
      items: catFiltered.filter((i) => {
        const t = new Date(feedItemSortTime(i));
        return t >= def.from && t <= def.to;
      }),
    }))
    .filter((s) => s.items.length > 0);
}

