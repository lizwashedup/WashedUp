/**
 * Creator mode data layer (phase 4 logic).
 *
 * Everything here runs against the live phase 1 schema through RLS:
 * leadership comes from community_members (role leader/co_leader, active),
 * join approvals are leader UPDATEs on pending member rows, broadcasts are
 * leader INSERTs into community_broadcasts. No new migrations required for
 * this slice. Screens are functionally minimal per decision 15a (logic
 * before design).
 */

import { supabase } from './supabase';
import { isAdmin } from '../constants/Admin';
import { areaFromZip } from './zipAreas';
import { isViewingAsEventHost } from './viewAs';
import type { OperatorGrantStatus, OperatorTrack } from './operatorApplications';
import type { TicketTier } from './ticketing';

export type CommunityMemberRole =
  | 'leader' | 'co_leader' | 'admin' | 'events' | 'member_care' | 'finance' | 'member';

/** The four tiers a co-creator invite can actually grant (never leader/member). */
export type CoCreatorRole = 'admin' | 'events' | 'member_care' | 'finance';

export interface LedCommunity {
  id: string;
  handle: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  role: Exclude<CommunityMemberRole, 'member'>;
}

export interface CreatorAccess {
  /** Communities this user actively leads or co-leads. */
  ledCommunities: LedCommunity[];
  hasLeaderGrant: boolean;
  hasEventHostGrant: boolean;
  /** True only when this user HAD an approved grant that was later revoked (inventory C-01). Never true for someone who was simply declined or never applied. */
  isRevoked: boolean;
}

export function hasCreatorAccess(a: CreatorAccess | undefined | null): boolean {
  if (!a) return false;
  return a.ledCommunities.length > 0 || a.hasLeaderGrant || a.hasEventHostGrant;
}

/** True only for the community's Owner (role='leader'). Ownership is unique per community. */
export function isOwner(a: CreatorAccess | undefined | null): boolean {
  if (!a) return false;
  return a.ledCommunities.some((c) => c.role === 'leader');
}

/** Owner or Admin (co_leader/admin are the same tier -- see CommunityMemberRole above). */
export function isAdminTier(a: CreatorAccess | undefined | null): boolean {
  if (!a) return false;
  return a.ledCommunities.some((c) => c.role === 'leader' || c.role === 'co_leader' || c.role === 'admin');
}

/**
 * Same admin-tier boundary as isAdminTier, scoped to a single role value
 * instead of the whole CreatorAccess. isAdminTier answers "is this person
 * admin-tier of ANY led community"; this answers it for ONE specific
 * community (e.g. LedCommunity.role for the currently-selected community),
 * which is the check an action scoped to that one community actually needs.
 */
export function isAdminTierRole(role: CommunityMemberRole): boolean {
  return role === 'leader' || role === 'co_leader' || role === 'admin';
}

/** Admin+ (Owner/Admin) plus the Events tier: event CRUD/publish, tickets, check-in, attendees. */
export function canManageEvents(a: CreatorAccess | undefined | null): boolean {
  if (!a) return false;
  return isAdminTier(a) || a.ledCommunities.some((c) => c.role === 'events');
}

/** Admin+ plus Member care: join-door, roster + approve/decline/remove/ban, room moderation. */
export function canManageMembers(a: CreatorAccess | undefined | null): boolean {
  if (!a) return false;
  return isAdminTier(a) || a.ledCommunities.some((c) => c.role === 'member_care');
}

/** Admin+ plus Finance: payouts/earnings view. */
export function canManageFinance(a: CreatorAccess | undefined | null): boolean {
  if (!a) return false;
  return isAdminTier(a) || a.ledCommunities.some((c) => c.role === 'finance');
}

/**
 * The one definition of "leader" for the whole creator shell (doc 34 §1).
 * Leaders (Owner/Admin) get all five tabs and land on today; an
 * event-host-only grant or a narrower community tier gets its own shell (see
 * creatorShellKind below) and must never reach today/members/community.
 */
export function isLeaderAccess(a: CreatorAccess | undefined | null): boolean {
  if (!a) return false;
  return isAdminTier(a) || a.hasLeaderGrant;
}

/**
 * S-03: which creator shell a user gets. 'full' = today's unchanged
 * Owner/Admin five-tab shell. 'organizer' = today's unchanged event-host-only
 * shell (organizer-home + events + attendees + menu), also reused for the
 * Events tier since its job matches it exactly. 'member_care' and 'finance'
 * are new, narrower shells. Same "any led community counts" pattern
 * isLeaderAccess already used.
 */
export type CreatorShellKind = 'full' | 'events' | 'member_care' | 'finance' | 'organizer';

export function creatorShellKind(a: CreatorAccess | undefined | null): CreatorShellKind {
  if (isLeaderAccess(a)) return 'full';
  if (!a) return 'organizer';
  if (a.ledCommunities.some((c) => c.role === 'events')) return 'events';
  if (a.ledCommunities.some((c) => c.role === 'member_care')) return 'member_care';
  if (a.ledCommunities.some((c) => c.role === 'finance')) return 'finance';
  return 'organizer';
}

/**
 * Where the creator switch (and any guard bounce) lands this user, one
 * landing route per creatorShellKind above.
 */
export function creatorLandingRoute(
  a: CreatorAccess | undefined | null,
): '/(creator)/today' | '/(creator)/organizer-home' | '/(creator)/members' | '/(creator)/menu' {
  switch (creatorShellKind(a)) {
    case 'full':
      return '/(creator)/today';
    case 'member_care':
      return '/(creator)/members';
    case 'finance':
      return '/(creator)/menu';
    case 'events':
    case 'organizer':
    default:
      return '/(creator)/organizer-home';
  }
}

/**
 * Display label for a co-creator's role, lowercase " · suffix" style
 * (members.tsx, member/[id].tsx). Empty string for a plain member (callers
 * already gate on role !== 'member' before rendering this).
 */
export function coCreatorRoleTag(role: CommunityMemberRole): string {
  switch (role) {
    case 'leader':
      return ' · community creator';
    case 'co_leader':
    case 'admin':
      return ' · admin';
    case 'events':
      return ' · events';
    case 'member_care':
      return ' · member care';
    case 'finance':
      return ' · finance';
    default:
      return '';
  }
}

export async function getCreatorAccess(): Promise<CreatorAccess> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) return { ledCommunities: [], hasLeaderGrant: false, hasEventHostGrant: false, isRevoked: false };

  // admin view-as (doc 00 7-13): force the event-host-only shape at the one
  // place every creator surface reads from. Admin-gated here too, so the
  // override is inert even if the flag were somehow flipped for anyone else.
  if (isViewingAsEventHost() && isAdmin(user.id)) {
    return { ledCommunities: [], hasLeaderGrant: false, hasEventHostGrant: true, isRevoked: false };
  }

  const [membershipResult, grantResult] = await Promise.all([
    supabase
      .from('community_members')
      .select('role, joined_at, communities ( id, handle, name, status )')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .neq('role', 'member')
      // deterministic order: the oldest-led community is the default the
      // switcher (lib/selectedCommunity) falls back to
      .order('joined_at', { ascending: true }),
    supabase
      .from('operator_grants')
      .select('track, status')
      .eq('user_id', user.id)
      .in('status', ['approved', 'revoked']),
  ]);
  if (membershipResult.error) throw membershipResult.error;
  if (grantResult.error) throw grantResult.error;
  const memberships = membershipResult.data;
  const grants = grantResult.data;

  const ledCommunities: LedCommunity[] = (memberships ?? [])
    .map((m: any) => {
      const c = m.communities;
      if (!c) return null;
      return { id: c.id, handle: c.handle, name: c.name, status: c.status, role: m.role };
    })
    .filter(Boolean) as LedCommunity[];

  const grantRows = (grants ?? []) as { track: OperatorTrack; status: OperatorGrantStatus }[];
  const approved = grantRows.filter((g) => g.status === 'approved');
  const hasLeaderGrant = approved.some((g) => g.track === 'community_leader');
  const hasEventHostGrant = approved.some((g) => g.track === 'event_host');
  return {
    ledCommunities,
    hasLeaderGrant,
    hasEventHostGrant,
    // revoked only means something when it is the reason access is now
    // absent (inventory C-01): someone who still leads a community, or still
    // holds the other track's approved grant, was not meaningfully "revoked".
    isRevoked:
      ledCommunities.length === 0 &&
      !hasLeaderGrant &&
      !hasEventHostGrant &&
      grantRows.some((g) => g.status === 'revoked'),
  };
}

// -- members ------------------------------------------------------------------

/**
 * Publish a draft community: status draft -> active through the leader-scoped
 * communities_update RLS policy. Only active communities are world-readable
 * (lock view, discovery, member pages); this is the one-way door that opens
 * the page. archiveCommunity (below) is the matching leader-gated closing
 * door.
 */
export async function publishCommunity(communityId: string): Promise<void> {
  const { error } = await supabase
    .from('communities')
    .update({ status: 'active' })
    .eq('id', communityId)
    .eq('status', 'draft');
  if (error) throw error;
}

/**
 * Archive a community: status -> archived, through the same leader-scoped
 * communities_update RLS policy publishCommunity uses above
 * (is_community_leader). SOFT-DELETE ONLY: no row is ever deleted, and no
 * other status write happens here. communities_select and the topic/message
 * RLS already carve out is_community_member regardless of status, so
 * existing members keep their page, chat history, and roster; the
 * discovery/browse RPC already filters to status = 'active', so an archived
 * community stops surfacing there with no further change needed. Reachable
 * from either 'draft' or 'active' (not only 'active'): a leader can also put
 * away a stale draft they never published. Guarded against re-archiving an
 * already-archived row.
 */
export async function archiveCommunity(communityId: string): Promise<void> {
  const { error, count } = await supabase
    .from('communities')
    .update({ status: 'archived' }, { count: 'exact' })
    .eq('id', communityId)
    .neq('status', 'archived');
  if (error) throw error;
  if (!count) throw new Error('Could not archive that community.');
}

/**
 * Unpublish a live community: status active -> draft, the exact reverse of
 * publishCommunity() through the same leader-scoped communities_update RLS
 * policy. Screen 14 (public page control center)'s one-way-door-in-reverse
 * action, DIFFERENT from archiveCommunity() above: draft is a fully
 * reversible, still-editable state a leader can re-publish anytime, not the
 * soft-delete/wind-down archiveCommunity is for. Does not touch
 * discoverable -- an unpublished community is already excluded from
 * get_discoverable_communities() via status alone, see
 * getCommunityDiscoverable() below.
 */
export async function unpublishCommunity(communityId: string): Promise<void> {
  const { error } = await supabase
    .from('communities')
    .update({ status: 'draft' })
    .eq('id', communityId)
    .eq('status', 'active');
  if (error) throw error;
}

/**
 * The community's shareable public link (Screen 14). washedup.app/c/<handle>
 * is the live web route (web:src/app/c/[handle]/page.tsx per the delta
 * matrix), the same format already shown as copy in setup-community.tsx.
 * Pure formatting, no network -- same shape as lib/yours/invite.ts's
 * referral-link builder.
 */
export function buildCommunityPublicLink(handle: string): string {
  return `https://washedup.app/c/${handle}`;
}

/**
 * Whether the community appears in general browse/search (Screen 14's
 * discovery toggle), backed by communities.discoverable
 * (supabase/migrations/20260901030000, DRAFT -- not applied). SELF-FLIPPING,
 * same mechanism as getJoinPolicy: until that migration applies, the select
 * errors with 42703 and this returns null, so the toggle stays hidden -- no
 * dead control. The moment it applies, the real value flows and the toggle
 * wakes.
 */
export async function getCommunityDiscoverable(communityId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('communities')
    .select('discoverable')
    .eq('id', communityId)
    .single();
  if (error || !data) return null; // column absent (42703) or unreadable = dormant
  const v = (data as { discoverable?: unknown }).discoverable;
  return typeof v === 'boolean' ? v : null;
}

/**
 * Leader-only by the existing communities_update RLS policy. No dedicated
 * RPC -- unlike join_policy, flipping discoverable carries no side effect to
 * guard (nothing else reads or reacts to it), so a plain update is the
 * conservative choice, the same shape publishCommunity() already uses.
 * Checks {count:'exact'} the same way archiveCommunity() and
 * updateJoinGateSettings() do, so a denied write (not a leader) cannot
 * silently report success while changing zero rows.
 */
export async function setCommunityDiscoverable(
  communityId: string,
  discoverable: boolean,
): Promise<boolean> {
  const { error, count } = await supabase
    .from('communities')
    .update({ discoverable }, { count: 'exact' })
    .eq('id', communityId);
  return !error && !!count;
}

/**
 * Whether this community has a genuine eligibility restriction (Liz decision
 * #11, 2026-09-03: the join gate's rules-confirmation question is only
 * offered "when the community has a genuine eligibility restriction").
 * Backed by communities.restricted_gender
 * (supabase/migrations/20260901080000_gender_restricted_communities.sql,
 * DRAFT -- not applied). SELF-FLIPPING, same mechanism as getJoinPolicy /
 * getCommunityDiscoverable above: until that migration lands, the select
 * errors (42703) and this returns null, so "no restriction" is simply true
 * today -- no community can be restricted before the column exists.
 */
export async function getCommunityRestrictedGender(communityId: string): Promise<RestrictedGender | null> {
  const { data, error } = await supabase
    .from('communities')
    .select('restricted_gender')
    .eq('id', communityId)
    .maybeSingle();
  if (error || !data) return null; // column absent (42703) or unreadable = no restriction
  const v = (data as { restricted_gender?: string | null }).restricted_gender;
  return v === 'woman' || v === 'man' ? v : null;
}

export interface CommunityMemberRow {
  id: string;
  user_id: string;
  community_id: string;
  role: CommunityMemberRole;
  status: 'pending' | 'active' | 'left' | 'removed' | 'banned';
  join_answers: Record<string, unknown> | null;
  joined_at: string | null;
  created_at: string;
  name: string | null;
  photo_url: string | null;
}

/**
 * Cheap counts-only read for the join-gate screen's live preview (inventory
 * C-08): a leader should see real numbers next to the who-gets-in picker,
 * not just three unlabeled pills. head:true skips row bodies entirely, so
 * this never fetches the profile joins getCommunityMembers does.
 */
export interface CommunityMemberCounts {
  active: number;
  pending: number;
}

export async function getCommunityMemberCounts(communityId: string): Promise<CommunityMemberCounts> {
  const [{ count: active }, { count: pending }] = await Promise.all([
    supabase.from('community_members').select('id', { count: 'exact', head: true }).eq('community_id', communityId).eq('status', 'active'),
    supabase.from('community_members').select('id', { count: 'exact', head: true }).eq('community_id', communityId).eq('status', 'pending'),
  ]);
  return { active: active ?? 0, pending: pending ?? 0 };
}

export async function getCommunityMembers(communityId: string): Promise<CommunityMemberRow[]> {
  const { data, error } = await supabase
    .from('community_members')
    .select('id, user_id, community_id, role, status, join_answers, joined_at, created_at')
    .eq('community_id', communityId)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profiles } = await supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', ids);
  const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  return rows.map((r) => ({
    ...r,
    name: byId.get(r.user_id)?.first_name_display ?? null,
    photo_url: byId.get(r.user_id)?.profile_photo_url ?? null,
  })) as CommunityMemberRow[];
}

/**
 * C-10 removed-state view: members a leader removed, or who were banned.
 * 'left' (member's own choice) and 'declined' (a request that never got in)
 * are deliberately excluded -- not a leader action, and the rest of the
 * codebase (stripe-webhook, create-checkout-session, community-thread/[id])
 * already treats removed+banned as one 'kicked, must stick' class. No writer
 * for 'banned' exists in either app today (only removeMember() writes
 * 'removed'); included for schema completeness in case that changes.
 */
export async function getRemovedCommunityMembers(communityId: string): Promise<CommunityMemberRow[]> {
  const { data, error } = await supabase
    .from('community_members')
    .select('id, user_id, community_id, role, status, join_answers, joined_at, created_at')
    .eq('community_id', communityId)
    .in('status', ['removed', 'banned'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const ids = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profiles } = await supabase
    .from('profiles_public')
    .select('id, first_name_display, profile_photo_url')
    .in('id', ids);
  const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    name: byId.get(r.user_id)?.first_name_display ?? null,
    photo_url: byId.get(r.user_id)?.profile_photo_url ?? null,
  })) as CommunityMemberRow[];
}

/**
 * C-11 member detail: a single member row by its community_members id, same
 * shape getCommunityMembers already returns per-row. Leader-scoped by the
 * same RLS as the list read.
 */
export async function getCommunityMember(memberRowId: string): Promise<CommunityMemberRow | null> {
  const { data, error } = await supabase
    .from('community_members')
    .select('id, user_id, community_id, role, status, join_answers, joined_at, created_at')
    .eq('id', memberRowId)
    .maybeSingle();
  if (error || !data) return null;
  const { data: profile } = await supabase
    .from('profiles_public')
    .select('first_name_display, profile_photo_url')
    .eq('id', data.user_id)
    .maybeSingle();
  return {
    ...data,
    name: profile?.first_name_display ?? null,
    photo_url: profile?.profile_photo_url ?? null,
  } as CommunityMemberRow;
}

/**
 * C-11 member detail: this member's real history in the community's own
 * events -- ticket purchases (ticket_orders, keyed by buyer_user_id) plus
 * plain RSVPs (explore_event_rsvps, the free_event path with no order row).
 * An event with BOTH shows once, as the ticket (a purchase is the stronger
 * fact). No notes-style field exists anywhere on community_members or its
 * neighbors (checked: only unrelated internal tables -- operator grant
 * review notes, office tasks/finance -- carry a `notes` column), so there is
 * nothing to surface there; this function deliberately returns history only.
 * Every read degrades to [] rather than throwing: RLS on ticket_orders is
 * organizer-scoped (lib/ticketAttendees.ts), so a leader viewing a
 * co-creator's event may legitimately see a thinner list, not an error.
 */
export interface MemberEventHistoryItem {
  eventId: string;
  title: string;
  eventDate: string | null;
  imageUrl: string | null;
  kind: 'ticket' | 'rsvp';
  tierName: string | null;
  orderStatus: string | null;
  refunded: boolean;
  at: string | null;
}

export async function getMemberEventHistory(
  communityId: string,
  memberUserId: string,
): Promise<MemberEventHistoryItem[]> {
  const { data: events, error: eventsErr } = await supabase
    .from('explore_events')
    .select('id, title, event_date, image_url')
    .eq('community_id', communityId);
  if (eventsErr || !events || events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const eventById = new Map(events.map((e) => [e.id, e]));

  const [ticketsRes, rsvpsRes] = await Promise.allSettled([
    supabase
      .from('ticket_orders')
      .select('event_id, status, created_at, refunded_cents, ticket_tiers ( name )')
      .eq('buyer_user_id', memberUserId)
      .in('event_id', eventIds),
    supabase
      .from('explore_event_rsvps')
      .select('explore_event_id, created_at')
      .eq('user_id', memberUserId)
      .eq('status', 'going')
      .in('explore_event_id', eventIds),
  ]);

  const items: MemberEventHistoryItem[] = [];

  if (ticketsRes.status === 'fulfilled' && !ticketsRes.value.error) {
    for (const row of (ticketsRes.value.data ?? []) as any[]) {
      const ev = eventById.get(row.event_id);
      if (!ev) continue;
      items.push({
        eventId: row.event_id,
        title: ev.title,
        eventDate: ev.event_date,
        imageUrl: ev.image_url,
        kind: 'ticket',
        tierName: row.ticket_tiers?.name ?? null,
        orderStatus: row.status ?? null,
        refunded: (row.refunded_cents ?? 0) > 0,
        at: row.created_at ?? null,
      });
    }
  }

  if (rsvpsRes.status === 'fulfilled' && !rsvpsRes.value.error) {
    const ticketedEventIds = new Set(items.map((i) => i.eventId));
    for (const row of (rsvpsRes.value.data ?? []) as any[]) {
      if (ticketedEventIds.has(row.explore_event_id)) continue;
      const ev = eventById.get(row.explore_event_id);
      if (!ev) continue;
      items.push({
        eventId: row.explore_event_id,
        title: ev.title,
        eventDate: ev.event_date,
        imageUrl: ev.image_url,
        kind: 'rsvp',
        tierName: null,
        orderStatus: null,
        refunded: false,
        at: row.created_at ?? null,
      });
    }
  }

  items.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  return items;
}

/**
 * Approve or decline a pending join request via the review_community_join
 * RPC (leader-gated server-side). Approval activates the member, drops the
 * system-composed intro card into the main community chat, and sends the
 * warm note. Decline sets the distinct 'declined' status and sends
 * a kind note; whether a declined person can re-request later is a logged
 * open question (currently blocked).
 */
export async function reviewJoinRequest(memberRowId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('review_community_join', {
    p_member_id: memberRowId,
    p_approve: approve,
  });
  if (error) throw error;
}

/**
 * The join-answer CARD a leader sees on pending requests: name, AREA
 * (never the raw zip), the intro answer, and the guidelines timestamp.
 * Email and raw zip stay stored, washedup-only (Liz's call, doc 13; the
 * 30a v1.3 disclosure promise).
 *
 * This is the proposal-42 self-flipping bridge: it reads the
 * get_join_answer_cards projection first (which is the ONLY leader read
 * once 42 lands and the raw table read goes dark), and until 42 applies
 * it falls back to the current leader RLS table read, shaping the same
 * card client-side (area via the zipAreas mirror). Keyed by the
 * membership row id.
 */
export interface JoinAnswerCard {
  first_name: string | null;
  last_name: string | null;
  area: string | null;
  intro_answer: string | null;
  guidelines_accepted_at: string | null;
  /** Liz decision #11 (2026-09-03): null on every card until a community turns a slot on. */
  reason_answer: string | null;
  source_answer: string | null;
  rules_confirmed: boolean | null;
  /** The leader's current custom prompt text, so a reviewer sees what was actually asked. */
  open_question: string | null;
  open_answer: string | null;
}

export async function getJoinAnswerCards(
  communityId: string,
): Promise<Map<string, JoinAnswerCard>> {
  const { data, error } = await supabase.rpc('get_join_answer_cards', {
    p_community_id: communityId,
  });
  if (!error) {
    return new Map(
      ((data ?? []) as (JoinAnswerCard & { member_id: string })[]).map((c) => [
        c.member_id,
        {
          first_name: c.first_name ?? null,
          last_name: c.last_name ?? null,
          area: c.area ?? null,
          intro_answer: c.intro_answer ?? null,
          guidelines_accepted_at: c.guidelines_accepted_at ?? null,
          reason_answer: c.reason_answer ?? null,
          source_answer: c.source_answer ?? null,
          rules_confirmed: c.rules_confirmed ?? null,
          open_question: c.open_question ?? null,
          open_answer: c.open_answer ?? null,
        },
      ]),
    );
  }
  // pre-42 fallback: the leader RLS table read still works; same card shape.
  // open_question is always null here (no join to communities in this
  // fallback path) -- a real gap only for an admin hitting this branch on a
  // community with the custom question configured, harmless otherwise since
  // this fallback is already dead for a non-admin leader post-42 (RLS narrows
  // the raw table to the answer's own user or an admin).
  const { data: rows, error: tableError } = await supabase
    .from('community_member_answers')
    .select('member_id, answers')
    .eq('community_id', communityId);
  if (tableError) throw tableError;
  return new Map(
    (rows ?? []).map((r: any) => {
      const a = (r.answers ?? {}) as Record<string, unknown>;
      return [
        r.member_id,
        {
          first_name: (a.first_name as string) ?? null,
          last_name: (a.last_name as string) ?? null,
          area: areaFromZip(a.zip as string),
          intro_answer: (a.intro_answer as string) ?? null,
          guidelines_accepted_at: (a.guidelines_accepted_at as string) ?? null,
          reason_answer: (a.reason_answer as string) ?? null,
          source_answer: (a.source_answer as string) ?? null,
          rules_confirmed: typeof a.rules_confirmed === 'boolean' ? a.rules_confirmed : null,
          open_question: null,
          open_answer: (a.open_answer as string) ?? null,
        },
      ];
    }),
  );
}

// -- join gate settings (doc 09: welcome message, intro question, guidelines) --

export interface JoinGateSettings {
  join_welcome_message: string | null;
  join_intro_question: string | null;
  guidelines_url: string | null;
}

// invite_only added (inventory C-08): the underlying invite-code generation
// and redemption flow does not exist yet, so this value has nowhere to be
// set from the UI until that ships. Keep the type honest about what the
// column can hold; do not build a UI path that cannot actually work yet.
export type JoinPolicy = 'approval_required' | 'open' | 'invite_only';

/**
 * The community's join gate (proposal 91, at Cowork's gate). SELF-FLIPPING:
 * until 91 adds communities.join_policy, the select errors with 42703 and
 * this returns null, so the leader toggle stays hidden - no dead control.
 * The moment 91 applies, the real value flows and the toggle wakes.
 */
export async function getJoinPolicy(communityId: string): Promise<JoinPolicy | null> {
  const { data, error } = await supabase
    .from('communities')
    .select('join_policy')
    .eq('id', communityId)
    .single();
  if (error || !data) return null; // column absent (42703) or unreadable = dormant
  const v = (data as { join_policy?: string }).join_policy;
  return v === 'open' || v === 'approval_required' ? v : null;
}

/**
 * Leader-or-admin only. Proposal 91 closes the raw client UPDATE on
 * join_policy: the table-level UPDATE grant is dropped and re-granted on the
 * twelve cosmetic/other columns, deliberately omitting join_policy, so the one
 * write door is set_community_join_policy(), a SECURITY DEFINER grant-checked
 * RPC that raises for a non-leader. A non-leader therefore comes back as
 * { error } now (not the old silent 0-row no-op), so !error is an honest
 * success signal and the caller's optimistic revert still fires on denial.
 * The RPC does not exist on prod until 91 lands, so this must merge and deploy
 * in the SAME window as the migration, never before it.
 */
export async function setJoinPolicy(
  communityId: string,
  policy: JoinPolicy,
): Promise<boolean> {
  const { error } = await supabase.rpc('set_community_join_policy', {
    p_community_id: communityId,
    p_join_policy: policy,
  });
  return !error;
}

export async function getJoinGateSettings(communityId: string): Promise<JoinGateSettings> {
  const { data, error } = await supabase
    .from('communities')
    .select('join_welcome_message, join_intro_question, guidelines_url')
    .eq('id', communityId)
    .single();
  if (error) throw error;
  return data as JoinGateSettings;
}

/** Leader-only by the communities_update RLS policy. Empty strings clear a field. */
export async function updateJoinGateSettings(
  communityId: string,
  settings: JoinGateSettings,
): Promise<void> {
  const { error, count } = await supabase
    .from('communities')
    .update(
      {
        join_welcome_message: settings.join_welcome_message?.trim() || null,
        join_intro_question: settings.join_intro_question?.trim() || null,
        guidelines_url: settings.guidelines_url?.trim() || null,
      },
      { count: 'exact' },
    )
    .eq('id', communityId);
  if (error) throw error;
  if (!count) throw new Error('That did not save.');
}

// -- join questions config (Liz decision #11, 2026-09-03): up to 3 more
// optional toggles plus a leader-authored open-ended prompt, on top of the
// always-on intro question above --

export interface JoinQuestionsConfig {
  askReason: boolean;
  askSource: boolean;
  askRulesConfirm: boolean;
  openQuestion: string | null;
}

/**
 * SELF-FLIPPING, same mechanism as getJoinPolicy / getCommunityDiscoverable:
 * until 20260904040000_configurable_join_questions.sql lands, the select
 * errors (42703) and this returns null, so the join-gate screen's "more
 * questions" section stays hidden -- no dead control. Kept separate from
 * getJoinGateSettings' own select (rather than merged into one query) so a
 * column-absent error here can never break reading the three fields that
 * already ship today.
 */
export async function getJoinQuestionsConfig(communityId: string): Promise<JoinQuestionsConfig | null> {
  const { data, error } = await supabase
    .from('communities')
    .select('join_ask_reason, join_ask_source, join_ask_rules_confirm, join_open_question')
    .eq('id', communityId)
    .maybeSingle();
  if (error || !data) return null; // column absent (42703) or unreadable = dormant
  const row = data as {
    join_ask_reason?: boolean | null;
    join_ask_source?: boolean | null;
    join_ask_rules_confirm?: boolean | null;
    join_open_question?: string | null;
  };
  return {
    askReason: row.join_ask_reason === true,
    askSource: row.join_ask_source === true,
    askRulesConfirm: row.join_ask_rules_confirm === true,
    openQuestion: row.join_open_question?.trim() || null,
  };
}

/**
 * Leader-only by the communities_update RLS policy -- same plain-update
 * shape as updateJoinGateSettings/setCommunityDiscoverable (no column-level
 * grant restricts these columns; confirmed by reading the actual
 * communities_update policy, a leader-or-admin row check with no per-column
 * carve-out). Empty question text clears the fifth slot, same "empty clears
 * a field" convention updateJoinGateSettings already uses.
 */
export async function updateJoinQuestionsConfig(
  communityId: string,
  config: JoinQuestionsConfig,
): Promise<boolean> {
  const { error, count } = await supabase
    .from('communities')
    .update(
      {
        join_ask_reason: config.askReason,
        join_ask_source: config.askSource,
        join_ask_rules_confirm: config.askRulesConfirm,
        join_open_question: config.openQuestion?.trim() || null,
      },
      { count: 'exact' },
    )
    .eq('id', communityId);
  return !error && !!count;
}

/**
 * CSV export for the active member list (inventory C-10). Pure formatting,
 * no network -- the caller already has the rows from getCommunityMembers.
 * Only name, role, and join date: the same fields the roster screen itself
 * shows, nothing beyond what a leader can already see there.
 */
export function membersToCsv(members: CommunityMemberRow[]): string {
  // A member name or role starting with =, +, -, or @ would otherwise be
  // interpreted as a formula by Excel/Sheets on open (CSV injection). Same
  // guard as organizationPurchasesToCsv in lib/ticketing.ts.
  const escape = (v: string) => {
    const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  const rows = members
    .filter((m) => m.status === 'active')
    .map((m) => [
      escape(m.name ?? 'someone'),
      escape(m.role),
      escape(m.joined_at ? m.joined_at.slice(0, 10) : ''),
    ].join(','));
  return ['name,role,joined', ...rows].join('\n');
}

/** Remove an active member (leader-only by RLS). */
export async function removeMember(memberRowId: string): Promise<void> {
  const { error, count } = await supabase
    .from('community_members')
    .update({ status: 'removed', role: 'member' }, { count: 'exact' })
    .eq('id', memberRowId)
    .eq('status', 'active')
    .eq('role', 'member'); // guard: never remove a leader row this way
  if (error) throw error;
  if (!count) throw new Error('Could not remove that member.');
}

/**
 * Liz decision #10 (2026-09-03): removal requires a recorded reason. Calls
 * the remove_community_member RPC (supabase/migrations/20260904000000_*),
 * which enforces the same active+member guard as removeMember() above plus
 * a non-empty reason, and records reason/timestamp/actor server-side. Behind
 * MEMBER_REMOVAL_REASON_ENABLED -- do not call unless that flag is on.
 */
export async function removeMemberWithReason(memberRowId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('remove_community_member', {
    p_member_id: memberRowId,
    p_reason: reason,
  });
  if (error) throw error;
}

/**
 * Liz decision #10 (2026-09-03): the leader can undo their own removal.
 * Calls the restore_community_member RPC, which refuses anything that isn't
 * a leader-initiated 'removed' row -- a platform ban never restores from
 * here. Behind MEMBER_REMOVAL_REASON_ENABLED -- do not call unless that flag
 * is on.
 */
export async function restoreMember(memberRowId: string): Promise<void> {
  const { error } = await supabase.rpc('restore_community_member', {
    p_member_id: memberRowId,
  });
  if (error) throw error;
}

// -- broadcasts ---------------------------------------------------------------

export interface BroadcastRow {
  id: string;
  body: string;
  pinned: boolean;
  created_at: string;
}

export async function getBroadcasts(communityId: string): Promise<BroadcastRow[]> {
  // creator surfaces count and list real announcements only: member messages
  // and intro cards share this table (kind 'message' / 'intro') but are not
  // broadcasts (tour part 1 finding 2 + part 2 reaction 4)
  const { data, error } = await supabase
    .from('community_broadcasts')
    .select('id, body, pinned, created_at')
    .eq('community_id', communityId)
    .eq('kind', 'broadcast')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as BroadcastRow[];
}

export async function sendBroadcast(communityId: string, body: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase.from('community_broadcasts').insert({
    community_id: communityId,
    sender_id: user.id,
    body: body.trim(),
  });
  if (error) throw error;
}

// -- events (read-only this slice) --------------------------------------------

export interface CommunityEventRow {
  id: string;
  title: string;
  event_date: string | null;
  venue: string | null;
  status: string;
  public_name: string | null;
  image_url: string | null;
  /** Non-null = a community-hosted event (inventory C-17 badge); null = the creator's own solo/organizer event. */
  community_id: string | null;
  /** C-16: RSVPs with status='going' for this event. 0 for ticketed-only events with no RSVP rows. */
  goingCount: number;
  /** C-16: paid ticket_orders qty, summed. */
  ticketsSold: number;
  /** C-16: this event's own ticket tiers, narrowed to what sumTierCapacity/deriveEventState need. */
  tiers: Pick<TicketTier, 'quantity_cap' | 'status'>[];
  /** C-16: the event's chat room archived flag. Null = no room was ever created (a standalone/personal event never gets a community_topics row) -- never read null as false. */
  roomArchived: boolean | null;
}

type BaseEventRow = Pick<
  CommunityEventRow,
  'id' | 'title' | 'event_date' | 'venue' | 'status' | 'public_name' | 'image_url' | 'community_id'
>;

/**
 * Live events attributed to the community or to the creator personally, plus
 * (C-16) batched per-event RSVP/ticket/room data so the events list can
 * derive real state (draft/scheduled/on sale/sold out/live/ended/cancelled/
 * archived) and surface what needs attention, without an N+1 query per card.
 * The four extra queries are best-effort (Promise.allSettled, same tolerance
 * pattern as getMemberEventHistory above): a failure there degrades that
 * event's numbers to 0/empty/null rather than losing the whole list.
 * NOTE (phase 5 gap, logged): explore_events RLS only exposes status='Live'
 * to non-admins, so an operator cannot yet see their own drafts or past
 * events. Owner-read policy + operator create/edit RPCs ride phase 5.
 */
export async function getCreatorEvents(
  communityIds: string[],
  userId: string,
): Promise<CommunityEventRow[]> {
  const ors: string[] = [`host_user_id.eq.${userId}`];
  if (communityIds.length > 0) ors.push(`community_id.in.(${communityIds.join(',')})`);
  const { data, error } = await supabase
    .from('explore_events')
    .select('id, title, event_date, venue, status, public_name, image_url, community_id')
    .or(ors.join(','))
    .order('event_date', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as BaseEventRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [rsvpsRes, ordersRes, tiersRes, roomsRes] = await Promise.allSettled([
    supabase.from('explore_event_rsvps').select('explore_event_id').eq('status', 'going').in('explore_event_id', ids),
    supabase.from('ticket_orders').select('event_id, qty').eq('status', 'paid').in('event_id', ids),
    supabase.from('ticket_tiers').select('event_id, quantity_cap, status').in('event_id', ids),
    supabase.from('community_topics').select('explore_event_id, archived').in('explore_event_id', ids),
  ]);

  const goingCounts = new Map<string, number>();
  if (rsvpsRes.status === 'fulfilled' && !rsvpsRes.value.error) {
    for (const row of (rsvpsRes.value.data ?? []) as { explore_event_id: string }[]) {
      goingCounts.set(row.explore_event_id, (goingCounts.get(row.explore_event_id) ?? 0) + 1);
    }
  }

  const soldCounts = new Map<string, number>();
  if (ordersRes.status === 'fulfilled' && !ordersRes.value.error) {
    for (const row of (ordersRes.value.data ?? []) as { event_id: string; qty: number }[]) {
      soldCounts.set(row.event_id, (soldCounts.get(row.event_id) ?? 0) + row.qty);
    }
  }

  const tiersByEvent = new Map<string, Pick<TicketTier, 'quantity_cap' | 'status'>[]>();
  if (tiersRes.status === 'fulfilled' && !tiersRes.value.error) {
    for (const row of (tiersRes.value.data ?? []) as { event_id: string; quantity_cap: number | null; status: TicketTier['status'] }[]) {
      const list = tiersByEvent.get(row.event_id) ?? [];
      list.push({ quantity_cap: row.quantity_cap, status: row.status });
      tiersByEvent.set(row.event_id, list);
    }
  }

  const roomArchivedByEvent = new Map<string, boolean>();
  if (roomsRes.status === 'fulfilled' && !roomsRes.value.error) {
    for (const row of (roomsRes.value.data ?? []) as { explore_event_id: string | null; archived: boolean }[]) {
      if (row.explore_event_id) roomArchivedByEvent.set(row.explore_event_id, row.archived);
    }
  }

  return rows.map((r) => ({
    ...r,
    goingCount: goingCounts.get(r.id) ?? 0,
    ticketsSold: soldCounts.get(r.id) ?? 0,
    tiers: tiersByEvent.get(r.id) ?? [],
    roomArchived: roomArchivedByEvent.has(r.id) ? (roomArchivedByEvent.get(r.id) as boolean) : null,
  }));
}

// -- stage 2: name your community (the creation wiring) -------------------------

/** The two restriction choices the create form exposes (see RestrictedGender below for why non-binary isn't a third). */
export type RestrictedGender = 'woman' | 'man';

/**
 * The one client door to community creation (create_community RPC, live on
 * prod: grant-gated definer, born DRAFT, seats the leader membership, seeds
 * the five starter blocks). The publish control stays the existing
 * publish-your-page flow; nothing here opens a page.
 *
 * restrictedGender and joinPolicy each ride the SAME conditional pattern
 * probeConfirmationMessage/createOperatorEvent already use for a
 * migration-gated optional param (lib/creatorEvents.ts): omitted (undefined)
 * means the RPC param is never sent at all, so a call with the matching flag
 * off is byte-identical to today and safe against a database where the
 * backing migration has NOT been applied (the RPC's live signature still
 * resolves). restrictedGender needs
 * supabase/migrations/20260901080000_gender_restricted_communities.sql and is
 * gated by GENDER_RESTRICTED_COMMUNITIES_ENABLED; joinPolicy needs
 * supabase/migrations/20260902200000_community_join_policy_at_creation.sql
 * and is gated by COMMUNITY_JOIN_POLICY_AT_CREATION_ENABLED. Only
 * setup-community.tsx, gated by those flags, ever passes either.
 */
export async function createCommunity(
  handle: string,
  name: string,
  city?: string,
  purpose?: string,
  restrictedGender?: RestrictedGender | null,
  joinPolicy?: JoinPolicy,
): Promise<string> {
  const restriction = restrictedGender !== undefined ? { p_restricted_gender: restrictedGender } : {};
  const policy = joinPolicy !== undefined ? { p_join_policy: joinPolicy } : {};
  const { data, error } = await supabase.rpc('create_community', {
    p_handle: handle,
    p_name: name,
    p_description: null,
    p_city: city?.trim() || null,
    p_purpose: purpose?.trim() || null,
    ...restriction,
    ...policy,
  });
  if (error) throw error;
  return data as string;
}

/**
 * A starting handle from the community name, matching the DB shape
 * (^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$): lowercase, hyphens between words,
 * 3-40 chars. The user edits it freely; validation is the regex below.
 */
export function suggestHandle(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export const HANDLE_SHAPE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
