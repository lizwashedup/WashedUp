import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ScrollView } from 'react-native';
import { X } from 'lucide-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import RequestRow from './RequestRow';
import BlockPrompt from './BlockPrompt';
import { COPY } from '../state/constants';
import { usePeopleConnectionMutations, friendlyConnectionError } from '../../../hooks/usePeopleConnectionMutations';
import { supabase } from '../../../lib/supabase';
import type { IncomingRequest } from '../../../lib/yours/types';

export type RequestAppearance = { fonts: AfterglowFontFamilies };
export type RequestStackProps = {
  visible: boolean; onClose: () => void; userId: string; requests: IncomingRequest[];
  highlightRequesterId?: string | null; appearance?: RequestAppearance;
};
type Owner = { visible: boolean; userId: string; revision: number };
type Kind = 'accept' | 'decline' | 'block';
type Operation = { req: IncomingRequest; kind: Kind; phase: 'pending' | 'error'; error?: string };
type Visit = { owner: Owner; resolved: Set<string>; operations: Record<string, Operation>; blocks: IncomingRequest[] };
type Attempt = { owner: Owner; req: IncomingRequest; kind: Kind };
const requestKey = (r: IncomingRequest) => `${r.connection_id}:${r.requester_user_id}:${r.requested_at}`;
const fresh = (owner: Owner): Visit => ({ owner, resolved: new Set(), operations: {}, blocks: [] });

/** Every decision belongs to a received request and one visible account visit.
 * A fulfilled existing void RPC is the confirmation; opening, tapping, or a
 * disappearing query row alone never confirms acceptance or soft decline. */
export default function RequestStack({ visible, onClose, userId, requests, highlightRequesterId, appearance }: RequestStackProps) {
  const { accept, decline } = usePeopleConnectionMutations(userId);
  const revisionRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const authUser = useRef<string | null | undefined>(undefined);
  const owner = useMemo<Owner>(() => ({ visible, userId, revision }), [visible, userId, revision]);
  const active = useRef<Owner | null>(null);
  const latest = useRef({ owner, requests, onClose });
  latest.current = { owner, requests, onClose };
  const [visit, setVisit] = useState<Visit>(() => fresh(owner));
  const state = visit.owner === owner ? visit : fresh(owner);
  const resolved = useRef(new Set<string>());
  // Retain outstanding locks through close/reopen: an old write can finish on
  // the server, but must not dispatch a duplicate or affect the new visit UI.
  const locks = useRef(new Map<string, Attempt>());
  useLayoutEffect(() => {
    active.current = owner; resolved.current = new Set(); setVisit(fresh(owner));
    return () => { if (active.current === owner) active.current = null; };
  }, [owner]);
  useEffect(() => {
    if (!visible) return;
    let listening = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!listening) return;
      const next = session?.user.id ?? null;
      const previous = authUser.current === undefined ? latest.current.owner.userId : authUser.current;
      authUser.current = next;
      if (previous !== next) { revisionRef.current++; setRevision(revisionRef.current); }
    });
    return () => { listening = false; subscription.unsubscribe(); };
  }, [visible]);
  const current = (captured: Owner) => active.current === captured && latest.current.owner === captured &&
    captured.visible && !!captured.userId && revisionRef.current === captured.revision &&
    (authUser.current === undefined || authUser.current === captured.userId);
  const change = (captured: Owner, update: (value: Visit) => Visit) => {
    if (current(captured)) setVisit(value => value.owner === captured ? update(value) : value);
  };
  const close = () => {
    if (active.current !== owner || !visible) return;
    active.current = null; latest.current.onClose();
  };
  const pending = useMemo(() => {
    const rows = requests.filter(r => !state.resolved.has(requestKey(r)));
    for (const operation of Object.values(state.operations)) {
      if (operation.kind !== 'block' && !rows.some(r => requestKey(r) === requestKey(operation.req))) rows.push(operation.req);
    }
    if (!highlightRequesterId) return rows;
    return [...rows].sort((a, b) => Number(b.requester_user_id === highlightRequesterId) - Number(a.requester_user_id === highlightRequesterId));
  }, [requests, state, highlightRequesterId]);
  const blockFor = state.blocks[0] ?? null;
  const operationPending = Object.values(state.operations).some(operation => operation.phase === 'pending');
  useEffect(() => {
    if (!current(owner) || pending.length || blockFor || operationPending) return;
    const timer = setTimeout(() => { if (current(owner)) close(); }, 600);
    return () => clearTimeout(timer);
  }, [owner, pending.length, blockFor, operationPending]);

  const perform = async (req: IncomingRequest, kind: Kind) => {
    const captured = owner, id = requestKey(req), lockKey = `${userId}:${id}`;
    if (!current(captured)) return;
    if (kind === 'block') {
      if (!blockFor || requestKey(blockFor) !== id) return;
    } else if (resolved.current.has(id)) return;
    const old = locks.current.get(lockKey);
    if (old) {
      if (old.owner !== captured) change(captured, value => ({ ...value, operations: { ...value.operations, [id]: { req, kind, phase: 'error', error: 'Your earlier request is still being saved. Try again shortly.' } } }));
      return;
    }
    if (kind !== 'block' && !latest.current.requests.some(row => requestKey(row) === id)) return;
    const attempt: Attempt = { owner: captured, req, kind };
    locks.current.set(lockKey, attempt);
    change(captured, value => ({ ...value, operations: { ...value.operations, [id]: { req, kind, phase: 'pending' } } }));
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!current(captured)) return;
      if (error) throw error;
      if (!user || user.id !== captured.userId) throw new Error('account_changed');
      if (kind !== 'block' && !latest.current.requests.some(row => requestKey(row) === id)) {
        throw new Error('no_pending_request');
      }
      // The existing mutations reject RPC errors and fulfill void on success.
      // No optimistic removal or block escalation precedes this confirmation.
      const scope = { userId: captured.userId, isCurrent: () => current(captured),
        canDispatch: () => kind === 'block' || latest.current.requests.some(row => requestKey(row) === id) };
      if (kind === 'accept') await accept.mutateAsync(req.requester_user_id, { scope });
      else await decline.mutateAsync({ requesterId: req.requester_user_id, block: kind === 'block' }, { scope });
      if (!current(captured)) return;
      resolved.current.add(id);
      change(captured, value => {
        const operations = { ...value.operations }; delete operations[id];
        return { ...value, operations, resolved: new Set(value.resolved).add(id),
          blocks: kind === 'decline' ? [...value.blocks, req] : kind === 'block' ? value.blocks.filter(r => requestKey(r) !== id) : value.blocks };
      });
    } catch (error) {
      if (!current(captured)) return;
      const message = (error as Error)?.message === 'account_changed' ? 'Your account changed. Close and reopen requests before trying again.' : friendlyConnectionError(error);
      change(captured, value => ({ ...value, operations: { ...value.operations, [id]: { req, kind, phase: 'error', error: message } } }));
    } finally {
      if (locks.current.get(lockKey) === attempt) locks.current.delete(lockKey);
    }
  };
  const dismissBlock = (req: IncomingRequest) => {
    const id = requestKey(req);
    if (state.operations[id]?.phase === 'pending' || locks.current.has(`${userId}:${id}`)) return;
    change(owner, value => {
      const operations = { ...value.operations }; delete operations[id];
      return { ...value, operations, blocks: value.blocks.filter(r => requestKey(r) !== id) };
    });
  };
  const s = useMemo(() => appearance ? { ...styles, ...requestAppearance(appearance.fonts) } : styles, [appearance?.fonts]);
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={close} onAccessibilityEscape={close}>
      <SafeAreaProvider>
        <SafeAreaView key={`${userId}:${revision}`} style={s.container} edges={['top', 'bottom']}>
          <View style={s.header}>
            <Text style={s.title}>{appearance ? 'Connection requests' : COPY.requestListTitle}</Text>
            <Pressable style={s.close} onPress={close} accessibilityRole="button" accessibilityLabel="Close requests">
              <X size={24} color={appearance ? AfterglowColors.ink : Colors.asphalt} />
            </Pressable>
          </View>
          {blockFor ? (
            <ScrollView contentContainerStyle={s.blockWrap} keyboardShouldPersistTaps="handled">
              <BlockPrompt key={requestKey(blockFor)} name={blockFor.first_name_display ?? 'them'}
                onBlock={() => { void perform(blockFor, 'block'); }} onKeep={() => dismissBlock(blockFor)}
                pending={state.operations[requestKey(blockFor)]?.phase === 'pending'}
                error={state.operations[requestKey(blockFor)]?.error} appearance={appearance} />
            </ScrollView>
          ) : pending.length ? (
            <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {pending.map(req => {
                const operation = state.operations[requestKey(req)];
                const unavailable = operation?.phase === 'error' && !requests.some(row => requestKey(row) === requestKey(req));
                return <RequestRow key={requestKey(req)} req={req} appearance={appearance}
                  highlighted={req.requester_user_id === highlightRequesterId}
                  disabled={!current(owner) || operation?.phase === 'pending'} unavailable={unavailable}
                  pendingAction={operation?.phase === 'pending' ? operation.kind === 'accept' ? 'accept' : 'decline' : undefined}
                  error={operation?.error} retryAction={operation?.phase === 'error' ? operation.kind === 'accept' ? 'accept' : 'decline' : undefined}
                  onAdd={() => { void perform(req, 'accept'); }} onDecline={() => { void perform(req, 'decline'); }} />;
              })}
            </ScrollView>
          ) : <View style={s.empty}><Text style={s.emptyText}>{COPY.requestListEmpty}</Text></View>}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displaySM,
    color: Colors.asphalt,
  },
  close: { padding: 8 },
  list: { paddingTop: 4, paddingBottom: 32 },
  blockWrap: { flex: 1, justifyContent: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayMD,
    color: Colors.secondary,
    textAlign: 'center',
  },
});

function requestAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: AfterglowColors.paper },
    title: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink, flex: 1 },
    close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    header: { ...styles.header, gap: 10, paddingBottom: 20 },
    blockWrap: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
    emptyText: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, textAlign: 'center' },
  });
}
