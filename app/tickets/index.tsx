import { EventMediaImage } from '../../components/events/EventMediaImage';
/**
 * C3 - your tickets (doc 79 C3). The buyer's confirmed orders; a ticket reads
 * as arrival, not a receipt. Animated QR is a later polish, not launch-blocking
 * (doc 78 §4).
 *
 * Each SEAT is the ticket: the door checks ticket_order_positions.reference_code
 * (record_ticket_checkin), so that code (never an order-id prefix) is what a
 * seat shows, as a QR the door scanner reads plus the same code in text for the
 * type-a-code path. A voided seat (partial refund) keeps its place in the list
 * but loses its QR, so nobody walks up with a dead code.
 *
 * Scene design spec item 05 (creator-branded ticketing, launch priority per
 * Liz): every card carries the event's own image + creator byline ("put on
 * by X"), and the empty state is a real invitation with a CTA rather than a
 * bare sentence - this repo's own CLAUDE.md already bans a bare "no X yet"
 * with nothing tappable, and the old copy here was exactly that.
 */

import React from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { ArrowLeft, Ticket, Compass } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { EventAction, EventSpacing } from '../../constants/EventDesign';
import { formatEventDateLA } from '../../lib/laDate';
import { getOrganizerProfiles } from '../../lib/organizerProfile';
import { usePublicPageScope } from '../../hooks/usePublicPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { stashPendingDestination } from '../../lib/pendingLink';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { loadPublishedEventPageIdentities } from '../../lib/publishedPageIdentity';
import { eventPageIdentity } from '../../lib/eventPageIdentity';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import {
  REFUND_DISCLOSURE, checkRefundAttempt, executeRefund, formatCents, getConfirmationMessage,
  getMyOrders, previewRefund,
  type MyOrder, type MySeat, type RefundPreview,
} from '../../lib/ticketing';

/** Screen 29 (Liz, Build 35 PDF): the wallet groups into Upcoming and Past,
 *  not one flat list. Same boundary the per-seat "expired" note already uses. */
function isEventEnded(o: Pick<MyOrder, 'event_date'>): boolean {
  return !!o.event_date && new Date(o.event_date) < new Date();
}

/**
 * doc 111: the organizer's "after they buy" note stays on the tickets, the
 * documented gold-border quote treatment (the organizer speaking, no new
 * accents). Renders nothing until SQL-96's column lands (self-flipping read).
 */
function OrganizerNote({ eventId, owner }: { eventId: string; owner: CreatorPageScope }) {
  const { data: note } = useQuery({
    queryKey: ['confirmation-message', eventId, owner.userId],
    queryFn: () => getConfirmationMessage(eventId, true, owner),
    staleTime: 60_000,
  });
  if (!note) return null;
  return (
    <View style={styles.organizerNote}>
      {/* copy to the taste gate */}
      <Text style={styles.organizerNoteLabel}>from the organizer</Text>
      <Text style={styles.organizerNoteText}>{note}</Text>
    </View>
  );
}

// the scanner reads from arm's length in door light; smaller and a 10-char
// code still scans, but this size is comfortable on every supported width
const QR_SIZE = 168;
// quiet zone is part of the QR spec: scanners need clear margin around the marks
const QR_QUIET_ZONE = 12;

function SeatTicket({
  seat,
  qty,
  eventEnded,
  eventId,
}: {
  seat: MySeat;
  qty: number;
  eventEnded: boolean;
  eventId: string;
}) {
  if (seat.voided) {
    return (
      <View style={styles.seat}>
        {qty > 1 && (
          /* copy to the taste gate: per-seat label */
          <Text style={styles.seatLabel}>ticket {seat.position_index} of {qty}</Text>
        )}
        <Text style={styles.seatCodeVoided}>{seat.reference_code}</Text>
        {/* copy to the taste gate */}
        <Text style={styles.seatVoidedNote}>this one was refunded and won't scan</Text>
      </View>
    );
  }
  // Screen 29/30 (Build 35 delta matrix): "active" is its own named state in
  // the state machine (reserved -> payment_pending -> paid_needs_details ->
  // active -> checked_in), distinct from checked_in and from an ended event.
  // The QR only gets anyone through a door while the seat is genuinely
  // active -- once it's checked in or the event's over, that code is
  // functionally dead the same way a voided seat's is (TK-07's own "nobody
  // walks up with a dead code" reasoning above), so it stops rendering.
  const isActive = !seat.checkedIn && !eventEnded;
  return (
    <View style={styles.seat}>
      {qty > 1 && (
        /* copy to the taste gate: per-seat label */
        <Text style={styles.seatLabel}>ticket {seat.position_index} of {qty}</Text>
      )}
      {isActive && (
        <View
          style={styles.qrWrap}
          accessible
          accessibilityLabel={`ticket code ${seat.reference_code}`}
        >
          <QRCode
            value={`https://washedup.app/e/${encodeURIComponent(eventId)}?ticket=${encodeURIComponent(seat.reference_code)}`}
            size={QR_SIZE}
            quietZone={QR_QUIET_ZONE}
            color={Colors.asphalt}
            backgroundColor={Colors.white}
          />
        </View>
      )}
      <Text style={styles.seatCode}>{seat.reference_code}</Text>
      {/* TK-07 (2026-08-19): the door's own record (ticket_checkins), not a
          guess. "waitlisted" and "transferred" are skipped here on purpose,
          neither exists anywhere in the schema yet (live-verified against
          the real check constraints) -- faking them would be worse than
          leaving them out. */}
      {seat.checkedIn ? (
        /* copy to the taste gate */
        <Text style={styles.seatCheckedInNote}>checked in</Text>
      ) : eventEnded ? (
        /* copy to the taste gate */
        <Text style={styles.seatExpiredNote}>expired, this one was never scanned</Text>
      ) : (
        // Screen 29: the state machine's other four reachable states here
        // (checked in, expired, refunded above) all already carried their
        // own label; this positive "active" one didn't. Mirrors the web
        // wallet's already-shipped "valid" pill (src/app/app/tickets/page.tsx,
        // walletTicketState) using this app's own documented confirmed-state
        // treatment (CLAUDE.md "Documented exceptions": goingConfirmedFill
        // fill + gold border + brandDeep label).
        <View style={styles.validBadge}>
          {/* copy to the taste gate */}
          <Text style={styles.validBadgeText}>valid</Text>
        </View>
      )}
    </View>
  );
}

const WALLET_REFUND_WAIT_MS = 12_000;
type WalletRefundState = 'unknown' | 'confirmed' | 'review';
async function boundedWalletRead<T>(scope: CreatorPageScope, read: (owned: CreatorPageScope) => Promise<T>): Promise<T> {
  let active = true;
  const owned = { userId: scope.userId, isCurrent: () => active && scope.isCurrent() };
  try { return await requestWithDeadline(read(owned), WALLET_REFUND_WAIT_MS); }
  finally { active = false; }
}

/**
 * Buyer self-refund (doc 108; web wallet f370d4b is the lockstep reference).
 * The affordance renders ONLY from the server's preview answer
 * (can_buyer_self_refund is the §5 preset gate); the client never decides
 * eligibility. The refund call itself sends no kind and no seats: the fn
 * forces buyer_request on the whole remaining order and re-checks the gate.
 */
function OrderRefund({ order, owner, refreshOrders, submitted, unavailable }: {
  order: MyOrder; owner: CreatorPageScope; refreshOrders(): Promise<MyOrder[] | undefined>;
  submitted: Map<string, WalletRefundState>; unavailable: boolean;
}) {
  const readPreview = React.useCallback((scope: CreatorPageScope) => boundedWalletRead(scope, owned => previewRefund(order.id, {}, owned)), [order.id]);
  const previewRead = useCreatorPageRead(order.status === 'paid' ? owner : null, readPreview);
  const preview = !previewRead.error ? previewRead.data : null;
  const latestPreview = React.useRef<{ data?: RefundPreview | null; error?: string; loading: boolean }>(previewRead);
  latestPreview.current = previewRead;
  const currentPreview = () => !latestPreview.current.error && !latestPreview.current.loading ? latestPreview.current.data : null;
  // Failed reconciliation may still refresh the list. Keep its original identity
  // independently so a second Check cannot adopt replacement rows as proof.
  const originalTickets = React.useRef({ userId: owner.userId, orderId: order.id, seats: order.seats.map(seat => ({ ...seat })) });
  if (originalTickets.current.userId !== owner.userId || originalTickets.current.orderId !== order.id) {
    originalTickets.current = { userId: owner.userId, orderId: order.id, seats: order.seats.map(seat => ({ ...seat })) };
  }
  const mounted = React.useRef(false), latest = React.useRef({ owner, order, unavailable });
  latest.current = { owner, order, unavailable };
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const inVisit = () => mounted.current && latest.current.owner === owner && owner.isCurrent();
  const current = () => inVisit() && !latest.current.unavailable;
  type Attempt = { active: boolean };
  type Review = { amount: number; count: number };
  const lock = React.useRef<Attempt | null>(null), confirmation = React.useRef<Review | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [needsCheck, setNeedsCheck] = React.useState(() => submitted.has(order.id));
  const needsCheckRef = React.useRef(needsCheck); needsCheckRef.current = needsCheck;
  const performRefund = async (review: Review) => {
    if (!current() || lock.current || confirmation.current !== review || submitted.has(order.id)
      || needsCheckRef.current || latest.current.order.status !== 'paid') return;
    confirmation.current = null;
    const fresh = currentPreview();
    if (!fresh?.allowed || !fresh.canSelfRefund || fresh.pendingAttempt || fresh.refundAmountCents !== review.amount || fresh.positionCount !== review.count) {
      needsCheckRef.current = true; setNeedsCheck(true); return;
    }
    // Keep this buyer/order consumed even if a failed read temporarily hides it.
    // Eligibility is not proof that an uncertain execution never reached Stripe.
    submitted.set(order.id, 'unknown');
    const attempt = { active: true }; lock.current = attempt; setBusy(true);
    const owned = { userId: owner.userId, isCurrent: () => attempt.active && lock.current === attempt && current() };
    try {
      const outcome = await requestWithDeadline(executeRefund(order.id, {
        reviewedAmountCents: review.amount, reviewedPositionCount: review.count,
      }, owned), WALLET_REFUND_WAIT_MS);
      if (!owned.isCurrent()) return;
      if (outcome.ok) {
        submitted.set(order.id, 'confirmed');
        void refreshOrders().catch(() => undefined);
        /* LIZ COPY (web's shipped strings, mirrored): pending is still success */
        Alert.alert(
          'refund on its way',
          outcome.pending
            ? 'your refund is on its way. it can take a minute to show here.'
            : 'refunded. it lands back on your card in a few days.',
        );
      } else {
        // Only the shared service's verified pre-dispatch outcome can
        // replace an unknown attempt. Fresh explicit reads must precede reuse.
        if (outcome.notStarted === true) submitted.set(order.id, 'review');
        Alert.alert('about that refund', outcome.message);
      }
    } catch { /* A timeout is an unknown result, never a failed or successful refund. */ }
    finally {
      attempt.active = false;
      if (lock.current === attempt) lock.current = null;
      if (inVisit()) { needsCheckRef.current = true; setNeedsCheck(true); setBusy(false); }
    }
  };
  if (unavailable || order.status !== 'paid') return null;
  const recovery = preview?.pendingAttempt ?? submitted.get(order.id);
  if (needsCheck || recovery || previewRead.error) return <View style={styles.refundBlock}>
    <Text accessibilityRole="alert" style={styles.refundDisclosure}>{needsCheck || recovery
      ? recovery === 'confirmed'
        ? 'The refund is on its way. Check status refreshes your tickets.'
        : recovery === 'review'
          ? 'No refund was started. Check status refreshes your tickets and refund options.'
          : recovery === 'unknown'
            ? 'The refund result isn’t confirmed. Check status refreshes your tickets.'
            : 'Refund details changed. Check status refreshes your tickets and refund options.'
      : 'Refund options could not be checked.'}</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check refund status" style={styles.refundButton} disabled={busy}
      onPress={async () => {
        if (!current() || lock.current) return;
        confirmation.current = null;
        const attempt = { active: true }; lock.current = attempt; setBusy(true);
        try {
          const owned = { userId: owner.userId, isCurrent: () => attempt.active && lock.current === attempt && current() };
          const result = await boundedWalletRead(owned, async visit => {
            const status = await checkRefundAttempt(order.id, visit);
            if (!visit.isCurrent()) throw new Error('This status check has ended.');
            const fresh = await refreshOrders();
            const refreshed = fresh?.find(row => row.id === order.id);
            if (!visit.isCurrent() || !refreshed || !['paid', 'refunded'].includes(refreshed.status)) throw new Error('Tickets could not be refreshed.');
            if (status.state === 'complete') {
              const originals = originalTickets.current.seats;
              const sameTickets = originals.length > 0 && refreshed.seats.length === originals.length
                && originals.every(original => refreshed.seats.some(seat => seat.id === original.id
                  && seat.position_index === original.position_index && seat.reference_code === original.reference_code));
              const indexes = status.target?.positionIndexes ?? null;
              const expectedCount = status.target?.reviewedPositionCount ?? originalTickets.current.seats.filter(seat => !seat.voided).length;
              const targetVoided = indexes === null ? refreshed.seats.every(seat => seat.voided)
                : indexes.every(index => refreshed.seats.some(seat => seat.position_index === index && seat.voided));
              if (!sameTickets || !targetVoided || expectedCount < 1 || status.positionsVoided !== expectedCount) {
                throw new Error('The completed refund is not reflected in the original tickets yet.');
              }
            }
            // Terminal orders have no paid-order preview. Keep their original voided codes.
            if (refreshed.status === 'refunded') return { status, freshPreview: null };
            const freshPreview = await previewRead.refresh();
            if (!freshPreview) throw new Error('Refund details could not be refreshed.');
            return { status, freshPreview };
          });
          const { status, freshPreview } = result;
          if (status.isCurrent && !status.isCurrent()) return;
          if (current() && lock.current === attempt) {
            latestPreview.current = { ...latestPreview.current, data: freshPreview, error: undefined, loading: false };
            if (!freshPreview?.pendingAttempt && (status.state === 'complete' || status.state === 'not-started'
              || submitted.get(order.id) === 'review')) submitted.delete(order.id);
            else if (status.state === 'confirmed') submitted.set(order.id, 'confirmed');
            needsCheckRef.current = submitted.has(order.id) || !!freshPreview?.pendingAttempt; setNeedsCheck(needsCheckRef.current);
          }
        }
        catch { /* Keep recovery visible; never replay the refund. */ }
        finally { attempt.active = false; if (lock.current === attempt) lock.current = null; if (inVisit()) setBusy(false); }
      }}><Text style={styles.refundButtonText}>{busy ? 'Checking…' : 'Check status'}</Text></TouchableOpacity>
  </View>;
  if (!preview?.allowed || !preview.canSelfRefund || !owner.isCurrent()) return null;

  const confirmRefund = () => {
    const fresh = currentPreview();
    if (!current() || lock.current || submitted.has(order.id) || needsCheckRef.current || !fresh?.allowed || !fresh.canSelfRefund || fresh.pendingAttempt) return;
    const review = { amount: fresh.refundAmountCents, count: fresh.positionCount };
    confirmation.current = review;
    Alert.alert(
      /* §5 disclosure leads (TK-08: consequence before amount); LIZ COPY RULED verbatim, never reworded */
      REFUND_DISCLOSURE,
      `refund ${formatCents(review.amount)} to your card?`,
      [
        { text: 'keep my tickets', style: 'cancel', onPress: () => { if (confirmation.current === review) confirmation.current = null; } },
        { text: 'yes, refund it', style: 'destructive', onPress: () => performRefund(review) },
      ],
    );
  };

  return (
    <View style={styles.refundBlock}>
      {/* §5 disclosure: LIZ COPY RULED verbatim, never reworded */}
      <Text style={styles.refundDisclosure}>{REFUND_DISCLOSURE}</Text>
      <TouchableOpacity
        style={styles.refundButton}
        onPress={confirmRefund}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="refund this purchase"
      >
        {busy ? (
          <ActivityIndicator size="small" color={EventAction.secondaryLabel} />
        ) : (
          /* LIZ COPY (web's trigger label, mirrored) — updated 2026-09-01: "order" -> "purchase"
             per Scene handoff §14 (no backend vocab in copy); web may still say "order", check
             before assuming parity */
          <Text style={styles.refundButtonText}>refund this purchase</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

/** Scene spec 05: no bare "no tickets yet" - an invitation with a CTA,
 *  matching this repo's own documented empty-state rule (and the exact
 *  shape components/yours/circles/CirclesEmptyState.tsx already uses). */
function TicketsEmptyState() {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIconBubble}>
        <Compass size={28} color={Colors.terracotta} strokeWidth={1.5} />
      </View>
      {/* copy to the taste gate */}
      <Text style={styles.emptyTitle}>no tickets yet</Text>
      {/* copy to the taste gate */}
      <Text style={styles.emptySub}>when you get one, it lives here. see what's happening tonight.</Text>
      <TouchableOpacity
        style={styles.emptyCta}
        onPress={() => router.push('/(tabs)/explore' as never)}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {/* copy to the taste gate: 2 words, won't wrap (button-label rule) */}
        <Text style={styles.emptyCtaText}>find plans</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function YourTicketsScreen() {
  const page = usePublicPageScope('ticket-wallet');
  const owner = React.useMemo<CreatorPageScope | null>(() => page.scope?.userId
    ? { userId: page.scope.userId, isCurrent: () => !!page.scope?.isCurrent() } : null, [page.scope]);
  const [entryError, setEntryError] = React.useState(false);
  if (!owner) return <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
    <View style={styles.headerRow}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}><ArrowLeft size={22} color={Colors.asphalt} /></TouchableOpacity><Text style={styles.headerTitle}>your tickets</Text></View>
    <View style={styles.content}>{page.account.isLoading ? <ActivityIndicator color={EventAction.primary} /> : <>
      <Text style={styles.cardMeta}>{page.account.error ? 'Your account could not be checked.' : 'Sign in with the account you used to get your tickets.'}</Text>
      <TouchableOpacity accessibilityRole="button" style={styles.refundButton} onPress={() => {
        if (page.account.error) { void page.account.retry(); return; }
        setEntryError(false);
        void stashPendingDestination('/tickets').then(() => { if (page.account.isCurrent()) router.push('/phone-entry' as never); })
          .catch(() => { if (page.account.isCurrent()) setEntryError(true); });
      }}><Text style={styles.refundButtonText}>{page.account.error ? 'Try again' : 'Sign in'}</Text></TouchableOpacity>
      {entryError && <Text accessibilityRole="alert" style={styles.cardMeta}>Your return link could not be saved. Try again.</Text>}
    </>}</View>
  </SafeAreaView>;
  return <OwnedTicketsScreen key={owner.userId} owner={owner} />;
}

function OwnedTicketsScreen({ owner }: { owner: CreatorPageScope }) {
  const readOrders = React.useCallback((scope: CreatorPageScope) => boundedWalletRead(scope, getMyOrders), []);
  const submittedRefunds = React.useRef(new Map<string, WalletRefundState>());
  const ordersRead = useCreatorPageRead(owner, readOrders);
  const orders = owner.isCurrent() ? ordersRead.data : undefined;
  const isLoading = ordersRead.loading && !orders;

  // Reuse the receipt's exact published-page identity. Only confirmed legacy
  // events may fall back to an account profile; identity failure never hides codes.
  const identityKey = JSON.stringify((orders ?? []).map(o => [o.event_id, o.event_community_id]));
  const readPages = React.useCallback(async (scope: CreatorPageScope) => {
    const events = JSON.parse(identityKey) as [string, string | null][];
    const links = await loadPublishedEventPageIdentities(events.map(([id]) => id), scope);
    return { key: identityKey, pages: new Map(events.map(([id, communityId]) =>
      [id, eventPageIdentity({ community_id: communityId }, links.get(id))])) };
  }, [identityKey]);
  const pagesRead = useCreatorPageRead(CREATOR_PAGES_ENABLED && orders?.length ? owner : null, readPages);
  const pages = !pagesRead.error && pagesRead.data?.key === identityKey ? pagesRead.data.pages : undefined;
  const isLegacy = (o: MyOrder) => !CREATOR_PAGES_ENABLED || !!pages?.has(o.event_id) && pages.get(o.event_id) === undefined;
  const creatorIds = [...new Set((orders ?? [])
    .filter((o) => isLegacy(o) && !o.event_public_name && !!o.event_host_user_id)
    .map((o) => o.event_host_user_id as string))];
  const { data: organizerProfiles } = useQuery({
    queryKey: ['organizer-profiles-wallet', owner.userId, creatorIds.join(',')],
    queryFn: () => getOrganizerProfiles(creatorIds),
    enabled: creatorIds.length > 0,
    staleTime: 60_000,
  });

  const bylineFor = (o: MyOrder): { name: string | null; logo: string | null } => {
    const page = pages?.get(o.event_id);
    if (page) return { name: page.name, logo: page.photoUrl };
    if (!isLegacy(o)) return { name: null, logo: null };
    if (o.event_public_name) return { name: o.event_public_name, logo: null };
    const p = o.event_host_user_id ? organizerProfiles?.get(o.event_host_user_id) : undefined;
    return { name: p?.display_name ?? null, logo: p?.logo_url ?? null };
  };

  // Screen 29: grouped sections, not one flat list (Liz's Build 35 PDF).
  // Each bucket keeps getMyOrders' own created_at-desc order untouched.
  const { upcomingOrders, pastOrders } = React.useMemo(() => {
    const upcoming: MyOrder[] = [];
    const past: MyOrder[] = [];
    for (const o of orders ?? []) {
      (isEventEnded(o) ? past : upcoming).push(o);
    }
    return { upcomingOrders: upcoming, pastOrders: past };
  }, [orders]);

  const renderOrderCard = (o: MyOrder) => {
    const byline = bylineFor(o);
    return (
      <View key={o.id} style={styles.card}>
        <TouchableOpacity
          style={styles.cardHeader}
          onPress={() => { if (owner.isCurrent()) router.push(`/event/${o.event_id}` as never); }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Open event: ${o.event_title ?? 'your event'}`}
        >
          {o.event_image ? (
            <EventMediaImage eventId={o.event_id} reference={o.event_image} style={styles.cardImage} contentFit="cover" />
          ) : (
            <View style={styles.cardIcon}>
              <Ticket size={20} color={EventAction.primary} strokeWidth={2} />
            </View>
          )}
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle} numberOfLines={1}>{o.event_title ?? 'your event'}</Text>
            {!!o.event_date && (
              <Text style={styles.cardMeta}>{formatEventDateLA(o.event_date)}</Text>
            )}
            <Text style={styles.cardMeta}>
              {o.qty} {o.qty === 1 ? 'ticket' : 'tickets'} · {o.total_cents === 0 ? 'free' : formatCents(o.total_cents)}{o.status === 'refunded' ? ' · refunded' : ''}
            </Text>
            {!!byline.name && (
              <View style={styles.cardCreatorRow}>
                {!!byline.logo && (
                  <Image source={{ uri: byline.logo }} style={styles.cardCreatorAvatar} contentFit="cover" />
                )}
                {/* LIZ COPY (decision 16): bylines say put on by, never hosted by */}
                <Text style={styles.cardCreatorText} numberOfLines={1}>put on by {byline.name}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        {o.status === 'paid' && <OrganizerNote eventId={o.event_id} owner={owner} />}
        {o.seats.map((seat) => (
          <SeatTicket
            key={seat.id}
            seat={seat}
            qty={o.qty}
            eventEnded={isEventEnded(o)}
            eventId={o.event_id}
          />
        ))}
        <OrderRefund order={o} owner={owner} refreshOrders={ordersRead.refresh} submitted={submittedRefunds.current} unavailable={!!ordersRead.error} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2} />
        </TouchableOpacity>
        {/* copy to the taste gate */}
        <Text style={styles.headerTitle}>your tickets</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {!!pagesRead.error && !!orders?.length && <View accessibilityRole="alert">
          <Text style={styles.cardMeta}>Creator details couldn’t be loaded. Your ticket codes are still available.</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry creator details" style={styles.refundButton} disabled={pagesRead.loading}
            onPress={() => { if (owner.isCurrent()) void pagesRead.refresh().catch(() => undefined); }}>
            <Text style={styles.refundButtonText}>{pagesRead.loading ? 'Checking…' : 'Try again'}</Text>
          </TouchableOpacity>
        </View>}
        {!!ordersRead.error && <View accessibilityRole="alert">
          <Text style={styles.cardMeta}>{orders ? 'Your tickets couldn’t be refreshed.' : 'Your tickets couldn’t be loaded.'}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry tickets" style={styles.refundButton} disabled={ordersRead.loading}
            onPress={() => { if (owner.isCurrent()) void ordersRead.refresh().catch(() => undefined); }}>
            <Text style={styles.refundButtonText}>{ordersRead.loading ? 'Checking…' : 'Try again'}</Text>
          </TouchableOpacity>
        </View>}
        {isLoading ? (
          <ActivityIndicator size="small" color={EventAction.primary} style={styles.loading} />
        ) : !orders || orders.length === 0 ? (
          !ordersRead.error && <TicketsEmptyState />
        ) : (
          <>
            {upcomingOrders.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Upcoming</Text>
                {upcomingOrders.map(renderOrderCard)}
              </>
            )}
            {pastOrders.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Past</Text>
                {pastOrders.map(renderOrderCard)}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  headerTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  headerSpacer: { flex: 1 },
  content: { padding: 20, gap: EventSpacing.md, flexGrow: 1 },
  // Golden Hour section-header spec (CLAUDE.md): 11px, terracotta, uppercase,
  // 1.5px tracking. No margins of its own -- content's own gap already spaces
  // every direct child uniformly, headers included.
  sectionHeader: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    color: Colors.terracotta,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  loading: { marginTop: EventSpacing.xl },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 40 },
  emptyIconBubble: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.emptyIconBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: EventSpacing.md,
  },
  emptyTitle: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displaySM, color: Colors.darkWarm, textAlign: 'center' },
  emptySub: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary,
    textAlign: 'center', marginTop: 8, marginBottom: EventSpacing.lg,
  },
  emptyCta: {
    minHeight: 44, paddingHorizontal: 24, borderRadius: 999, backgroundColor: Colors.terracotta,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.terracotta, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  emptyCtaText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  card: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: EventSpacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.brandSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardImage: { width: 44, height: 44, borderRadius: 12 },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  cardCreatorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  cardCreatorAvatar: { width: 14, height: 14, borderRadius: 7 },
  cardCreatorText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary },
  seat: {
    alignItems: 'center', gap: EventSpacing.xs,
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: EventSpacing.md,
  },
  seatLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  qrWrap: { borderRadius: 12, overflow: 'hidden' },
  seatCode: {
    fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, letterSpacing: 3,
  },
  seatCodeVoided: {
    fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.textLight,
    letterSpacing: 3, textDecorationLine: 'line-through',
  },
  seatVoidedNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  seatCheckedInNote: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  seatExpiredNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  // Screen 29: the "active" state badge -- same confirmed-state treatment as
  // FeaturedEventCard's ctaButtonJoined (CLAUDE.md documented exception).
  validBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: Colors.goingConfirmedFill,
    borderWidth: 1,
    borderColor: Colors.gold,
  },
  validBadgeText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.brandDeep },
  organizerNote: {
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 2, borderLeftColor: Colors.goldAccent,
    padding: 12, gap: 4,
  },
  organizerNoteLabel: {
    fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  organizerNoteText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.quoteText, lineHeight: 19 },
  refundBlock: {
    alignItems: 'center', gap: EventSpacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: EventSpacing.md,
  },
  refundDisclosure: {
    fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.textMedium,
    textAlign: 'center', paddingHorizontal: EventSpacing.sm,
  },
  refundButton: {
    minHeight: 44, borderRadius: 999, borderWidth: 1.5, borderColor: EventAction.secondaryBorder,
    paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
  },
  refundButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: EventAction.secondaryLabel },
});
