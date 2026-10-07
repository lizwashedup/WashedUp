/**
 * Circle chat screen.
 *
 * A circle now opens into the SAME polished chat as a plan (the shared
 * <ChatThread>), not the old stacked noticeboard. This thin wrapper resolves the
 * circle's identity/members (get_circle) and hands the rest to ChatThread:
 *   header  = {circle name} + "View circle" (-> detail page) + "+" menu
 *   "+"     = Add people | Make a plan, using the shared anchored menu
 *   chat    = persistent (never read-only), no countdown, no presence column
 *
 * Gated behind GROUPS_ENABLED; a direct hit with the flag off bounces to Chats.
 */
import React, { useState, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { GROUPS_ENABLED } from '../../../../constants/FeatureFlags';
import { COPY } from '../../../../components/yours/state/constants';
import { useCircle } from '../../../../hooks/useCircle';
import { circleDisplay } from '../../../../lib/circles/display';
import ChatThread, { ChatThreadMember } from '../../../../components/chat/ChatThread';

import { ChatEntryState } from '../../../../components/chat/ChatEntryState';
const ThreadComponent = ChatThread;
import AddPeopleSheet from '../../../../components/circles/AddPeopleSheet';
import CirclePlanComposer from '../../../../components/circles/plan/CirclePlanComposer';
import MenuCard, { type AnchorRect } from '../../../../components/menu/MenuCard';
import { buildComposerWithPerson } from '../../../../lib/composerLink';
import { CalendarPlus, Users } from 'lucide-react-native';

interface MenuVisit {
  serial: number;
  closing: boolean;
  action: 'plan' | 'circle' | null;
  person: { id: string; name: string; avatar: string | null } | null;
}

function CircleChatScreenInner({ circleId, reactionMessageId, reactionMessageSource }: { circleId: string; reactionMessageId?: string; reactionMessageSource?: string }) {
  const router = useRouter();
  const { data, isError, isLoading, isFetching, refetch, viewerId: myUserId, viewerEpoch: epoch, isCurrentViewer: isCurrentUser } = useCircle(circleId);
  const [addOpen, setAddOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<AnchorRect | null>(null);
  const [menuVisit, setMenuVisit] = useState<MenuVisit | null>(null);
  const activeMenu = useRef<MenuVisit | null>(null);
  const menuSerial = useRef(0), entrySerial = useRef(0);
  const entry = useMemo(() => ({ serial: ++entrySerial.current }), [circleId, myUserId, epoch, isError]);
  const activeEntry = useRef<typeof entry | null>(null);
  const entryReadable = useRef(false);
  entryReadable.current = !!myUserId && !!data && !isError;
  // A same-account metadata refresh must not remount an open child form and
  // discard its selections. Keep entry ownership stable, but read access live.
  const isCurrentEntry = useCallback(() => activeEntry.current === entry && entryReadable.current && isCurrentUser(),
    [entry, isCurrentUser]);
  const operationScope = useMemo(() => myUserId ? { userId: myUserId, isCurrent: isCurrentEntry } : null, [myUserId, isCurrentEntry]);
  const isCurrentMenu = useCallback(() => !!menuVisit && activeMenu.current === menuVisit && isCurrentEntry(), [menuVisit, isCurrentEntry]);

  useLayoutEffect(() => {
    activeEntry.current = entry;
    activeMenu.current = null;
    setAddOpen(false); setPlanOpen(false); setMenuOpen(false); setMenuAnchor(null); setMenuVisit(null);
    return () => {
      if (activeEntry.current === entry) activeEntry.current = null;
      activeMenu.current = null;
    };
  }, [entry]);

  // Memoized so the props handed to the (memoized) ChatThread stay referentially
  // stable across this screen's own state changes (+ menu, add-people, plan).
  const members: ChatThreadMember[] = useMemo(
    () =>
      (data?.members ?? []).map((m) => ({
        id: m.user_id,
        first_name: m.first_name_display,
        avatar_url: m.profile_photo_url,
      })),
    [data?.members],
  );
  const memberIds = useMemo(() => data?.members.map((m) => m.user_id) ?? [], [data?.members]);

  // A DM is an unnamed 2-person circle: render the counterpart (name + "View
  // {name}" -> their keep page) instead of "View circle". A grown DM (3+) and a
  // named circle both render as a circle. Gate on myUserId too: without it, both
  // members survive the self-filter and a DM would briefly mis-render as a
  // 2-person "unnamed circle" until auth resolves.
  const disp = useMemo(
    () =>
      data && myUserId
        ? circleDisplay(
            data.circle.name,
            data.members.map((m) => ({
              user_id: m.user_id,
              name: m.first_name_display,
              avatar_url: m.profile_photo_url,
            })),
            myUserId,
          )
        : null,
    [data, myUserId],
  );

  // Circle and DM actions share one anchored menu. Child sheets wait for
  // dismissal, and the existing account/room/visit guards own each action.
  const openPlusMenu = useCallback((anchor: AnchorRect) => {
    if (!isCurrentEntry()) return;
    const session: MenuVisit = {
      serial: ++menuSerial.current, closing: false, action: null,
      person: disp?.isDm && disp.otherUserId ? { id: disp.otherUserId, name: disp.title, avatar: disp.otherAvatar } : null,
    };
    activeMenu.current = session;
    setMenuVisit(session);
    setMenuAnchor(anchor);
    setMenuOpen(true);
  }, [disp, isCurrentEntry]);

  // Stable closures/objects for the memoized ChatThread.
  const onViewContext = useCallback(() => {
    if (!isCurrentEntry()) return;
    if (disp?.isDm && disp.otherUserId) {
      router.push(`/person/${disp.otherUserId}` as any);
    } else {
      router.push(`/circle/${circleId}` as any);
    }
  }, [disp, circleId, router, isCurrentEntry]);

  const headerMenu = useMemo(
    () => ({ type: 'plus' as const, onPress: openPlusMenu }),
    [openPlusMenu],
  );

  const menuRows = useMemo(
    () => [
      {
        key: 'plan',
        icon: CalendarPlus,
        label: COPY.menuMakePlan,
        subtitle: disp?.isDm ? COPY.menuMakePlanSub : 'Plan something with this circle',
        // From a DM: open the composer with the counterpart pre-attached as a
        // removable invite chip (a normal plan + invite), not the circle-plan
        // composer. Decided 2026-06-10 (Liz owns; sanity-check live).
        // Deferred to MenuCard's onClosed, same reason as "circle" below.
        onPress: () => {
          if (isCurrentMenu() && menuVisit && !menuVisit.action) menuVisit.action = 'plan';
        },
      },
      {
        key: 'circle',
        icon: Users,
        label: disp?.isDm ? COPY.menuStartCircle : 'Add people',
        subtitle: disp?.isDm ? COPY.menuStartCircleSub : 'Invite people into this circle',
        // Pulling more people into a DM grows it into a circle (the old
        // "Add people now", relabelled per the consistency rule). Deferred to
        // MenuCard's onClosed so AddPeopleSheet opens only after this menu's
        // modal has dismissed (no overlapping modals).
        onPress: () => {
          if (isCurrentMenu() && menuVisit && !menuVisit.action) menuVisit.action = 'circle';
        },
      },
    ],
    [isCurrentMenu, menuVisit, disp?.isDm],
  );

  if (isError || !data || !myUserId) {
    return <ChatEntryState state={isError ? 'error' : isLoading || myUserId === undefined ? 'loading' : 'unavailable'}
      retrying={isFetching || isLoading} onRetry={isError ? () => { void refetch(); } : undefined} onBack={() => router.back()} />;
  }

  return (
    <>
      <ThreadComponent
        reactionMessageId={reactionMessageId} reactionMessageSource={reactionMessageSource}
        kind="circle"
        id={circleId}
        title={disp?.title ?? '...'}
        subtitle={data && disp && !disp.isDm ? COPY.circleHomeMembers(members.length) : null}
        members={members}
        viewContextLabel={disp?.isDm ? COPY.dmViewPerson(disp.title) : COPY.circleViewButton}
        onViewContext={onViewContext}
        headerMenu={headerMenu}
        emptyText={COPY.circleChatStart}
      />
      <AddPeopleSheet
        key={`add:${entry.serial}`}
        visible={addOpen}
        circleId={circleId}
        scope={operationScope}
        existingMemberIds={memberIds}
        onClose={() => { if (isCurrentEntry()) setAddOpen(false); }}
      />
      <CirclePlanComposer
        key={`plan:${entry.serial}`}
        visible={planOpen}
        scope={operationScope}
        onClose={() => { if (isCurrentEntry()) setPlanOpen(false); }}
        circleId={circleId}
        circleName={disp?.title ?? data?.circle.name ?? ''}
        members={(data?.members ?? []).map((m) => ({
          user_id: m.user_id,
          first_name_display: m.first_name_display,
          handle: m.handle,
          profile_photo_url: m.profile_photo_url,
        }))}
        isDm={!!disp?.isDm}
        onCheckPlans={() => { if (isCurrentEntry()) router.push(`/circle/${circleId}` as any); }}
        onPosted={(result) => {
          if (!isCurrentEntry()) return;
          // Open plan / picked-subset plans get their own chat -> open it.
          // A whole-circle just-us plan lives in this circle chat already.
          if (result.has_own_chat) {
            router.push(`/plan/${result.event_id}` as any);
          }
        }}
      />
      <MenuCard
        key={`menu:${entry.serial}:${menuVisit?.serial ?? 'closed'}`}
        visible={menuOpen}
        onClose={() => {
          if (!isCurrentMenu() || !menuVisit) return;
          menuVisit.closing = true;
          setMenuOpen(false);
        }}
        onClosed={() => {
          // Both chat actions wait until the native menu fully dismisses. Own
          // that intent by this opening: an old dismiss callback must never
          // consume the action or counterpart of a newer menu/account/room.
          if (!isCurrentMenu() || !menuVisit?.closing) return;
          activeMenu.current = null;
          const action = menuVisit.action;
          menuVisit.action = null;
          setMenuOpen(false);
          if (action === 'circle') {
            setAddOpen(true);
          }
          if (action === 'plan' && menuVisit.person) {
            const { id, name, avatar } = menuVisit.person;
            router.push(buildComposerWithPerson(id, name, avatar) as never);
          } else if (action === 'plan') {
            setPlanOpen(true);
          }
        }}
        anchor={menuAnchor}
        placement="top-right"
        rows={menuRows}
      />
    </>
  );
}

export default function CircleChatScreen() {
  const { id, reactionMessageId, reactionMessageSource } = useLocalSearchParams<{ id: string; reactionMessageId?: string; reactionMessageSource?: string }>();
  if (!GROUPS_ENABLED || !id) {
    return <Redirect href="/(tabs)/chats" />;
  }
  return <CircleChatScreenInner circleId={id} reactionMessageId={reactionMessageId} reactionMessageSource={reactionMessageSource} />;
}

