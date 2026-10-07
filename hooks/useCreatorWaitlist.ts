import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getWaitlistForCreator, grantWaitlistException, closeWaitlist, reopenWaitlist, waitlistAlertMessage, type WaitlistManagerData } from '../lib/waitlistExceptions';
import { WAITLIST_MANAGER_KEY } from '../constants/QueryKeys';
import { getPlanLifecycle } from '../lib/planLifecycle';
import { logError } from '../lib/logger';
type Data = WaitlistManagerData & {
    ended: boolean;
};
type Action = {
    kind: 'grant';
    userId: string;
} | {
    kind: 'pause';
    closed: boolean;
};
type Attempt = {
    action: Action;
    phase: 'pending' | 'failed' | 'unknown';
};
type Options = {
    eventId: string;
    viewerId: string | null;
    epoch: number;
    isCurrent: () => boolean;
};
type State = {
    data: Data | null;
    error: string | null;
    accessError: boolean;
    loading: boolean;
    busy: boolean;
    attempt: Attempt | null;
    visit: object | null;
    revision: number;
};
const rejected = new Set(['P0001', '42501', '23502', '23503', '23505', '23514', '22P02', '28000', '28P01', '42883', '42703', '42P01', '40001', '40P01']);
export function nextWaitlistPerson(data: WaitlistManagerData | null) { return data?.rows.filter(r => r.kind === 'waitlist' && ['waiting', 'expired'].includes(r.exception_status)).sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0))[0]?.user_id ?? null; }
/** The saved grant RPC enforces the queue and cap. Client guards additionally
 * keep pending/uncertain operations from being replayed by this mounted route. */
export function useCreatorWaitlist(options: Options) {
    const client = useQueryClient(), latest = useRef(options);
    latest.current = options;
    const state = useMemo<State>(() => ({ data: null, error: null, accessError: false, loading: false, busy: false, attempt: null, visit: null, revision: 0 }), [options.eventId, options.viewerId, options.epoch]);
    const owner = useRef(state);
    owner.current = state;
    const [, redraw] = useState(0);
    const publish = () => { if (owner.current === state && state.visit && latest.current.isCurrent())
        redraw(n => n + 1); };
    const capture = () => { const visit = state.visit; return () => !!visit && state.visit === visit && owner.current === state && options.isCurrent(); };
    const invalidate = () => { for (const queryKey of [WAITLIST_MANAGER_KEY(options.eventId), ['events', 'detail', options.eventId]])
        void Promise.resolve(client.invalidateQueries({ queryKey })).catch(e => logError(e, 'waitlist.manager.refresh')); };
    const read = async (valid: () => boolean): Promise<Data | null> => {
        const auth = await supabase.auth.getUser();
        if (!valid())
            return null;
        if (auth.error || !options.viewerId || auth.data.user?.id !== options.viewerId)
            throw new Error('not_authenticated');
        const result = await supabase.from('events').select('id,creator_user_id,status,start_time,end_time,exception_slots_used,waitlist_closed').eq('id', options.eventId).single();
        if (!valid())
            return null;
        if (result.error)
            throw result.error;
        const p = result.data;
        if (!p || p.id !== options.eventId)
            throw new Error('not_found');
        if (p.creator_user_id !== options.viewerId)
            throw new Error('not_authorized');
        if (!Number.isInteger(p.exception_slots_used) || p.exception_slots_used < 0 || p.exception_slots_used > 3 || typeof p.waitlist_closed !== 'boolean' || typeof p.start_time !== 'string' || !Number.isFinite(Date.parse(p.start_time)) || (p.end_time !== null && (typeof p.end_time !== 'string' || !Number.isFinite(Date.parse(p.end_time)))))
            throw new Error('Invalid plan data');
        const rows = await getWaitlistForCreator(options.eventId);
        if (!valid())
            return null;
        const identities = new Set<string>();
        if (!Array.isArray(rows) || rows.some(r => !r || !['waitlist', 'accepted'].includes(r.kind) || typeof r.user_id !== 'string' || !r.user_id || !['waiting', 'invited', 'accepted', 'declined', 'expired'].includes(r.exception_status) || !Number.isInteger(r.total) || r.total < 0 || (r.kind === 'waitlist' && (!Number.isInteger(r.queue_position) || (r.queue_position ?? 0) < 1)) || (r.first_name !== null && typeof r.first_name !== 'string') || (r.photo !== null && typeof r.photo !== 'string') || (r.context !== null && typeof r.context !== 'string') || identities.has(`${r.kind}:${r.user_id}`) || (identities.add(`${r.kind}:${r.user_id}`), false)))
            throw new Error('Invalid queue data');
        return { rows, slotsUsed: p.exception_slots_used, closed: p.waitlist_closed, ended: getPlanLifecycle({ status: p.status, startTime: p.start_time, endTime: p.end_time }).isClosed };
    };
    const readError = (error: unknown) => { const message = String((error as any)?.message ?? ''); state.accessError = /not_authorized|not_authenticated|not_found/.test(message); if (state.accessError)
        state.data = null; state.error = state.accessError ? waitlistAlertMessage(error) : 'Couldn’t refresh the waitlist. Try again.'; };
    const refresh = async () => {
        if (!options.viewerId || !state.visit || !options.isCurrent() || state.busy)
            return;
        const visit = capture(), revision = ++state.revision, valid = () => visit() && state.revision === revision;
        state.loading = true;
        state.error = null;
        publish();
        try {
            const data = await read(valid);
            if (!data || !valid())
                return;
            state.data = data;
            state.accessError = false;
            const action = state.attempt?.action;
            if (state.attempt?.phase === 'unknown' && action) {
                const matched = action.kind === 'pause' ? data.closed === action.closed : data.rows.some(r => r.user_id === action.userId && ['invited', 'accepted', 'declined'].includes(r.exception_status));
                if (matched) {
                    state.attempt = null;
                    invalidate();
                }
                else
                    state.error = 'We still can’t confirm the change. Check again in a moment.';
            }
        }
        catch (e) {
            if (valid())
                readError(e);
        }
        finally {
            if (valid()) {
                state.loading = false;
                publish();
            }
        }
    };
    const readRef = useRef(refresh);
    readRef.current = refresh;
    useFocusEffect(useCallback(() => { const visit = {}; state.visit = visit; void readRef.current(); return () => { if (state.visit === visit) {
        state.visit = null;
        state.revision++;
    } }; }, [state]));
    const perform = async (action: Action, retry = false) => {
        if (!state.visit || !options.isCurrent() || !options.viewerId || state.busy || state.loading || !state.data || state.accessError)
            return;
        if (state.attempt && (!retry || state.attempt.phase !== 'failed' || state.attempt.action !== action))
            return;
        const attempt: Attempt = { action, phase: 'pending' }, valid = capture();
        state.attempt = attempt;
        state.busy = true;
        state.error = null;
        state.revision++;
        publish();
        let dispatched = false, confirmed = false;
        try {
            const data = await read(valid);
            if (!valid() || !data) {
                state.attempt = null;
                return;
            }
            state.data = data;
            if (data.ended) {
                state.attempt = null;
                state.error = 'This plan has ended. You can still review the waitlist.';
                return;
            }
            if (action.kind === 'grant' && (data.closed || data.slotsUsed >= 3 || nextWaitlistPerson(data) !== action.userId)) {
                state.attempt = null;
                state.error = 'The queue changed. Review the next person before saving a spot.';
                return;
            }
            if (action.kind === 'pause' && data.closed === action.closed) {
                state.attempt = null;
                return;
            }
            dispatched = true;
            if (action.kind === 'grant') {
                const count = await grantWaitlistException(options.eventId, action.userId);
                if (!Number.isInteger(count) || count < 1 || count > 3)
                    throw new Error('Unconfirmed grant');
            }
            else
                await (action.closed ? closeWaitlist(options.eventId) : reopenWaitlist(options.eventId));
            confirmed = true;
            state.attempt = null;
            if (owner.current === state && latest.current.isCurrent())
                invalidate();
            // Refresh before enabling another target. Failure here cannot undo a saved action.
            if (valid()) {
                state.data = null;
                const fresh = await read(valid);
                if (valid() && fresh) {
                    state.data = fresh;
                    state.accessError = false;
                }
            }
        }
        catch (e) {
            if (confirmed) {
                if (valid())
                    readError(e);
            }
            else {
                attempt.phase = dispatched && !rejected.has(String((e as any)?.code)) ? 'unknown' : 'failed';
                state.error = attempt.phase === 'unknown' ? 'This change may have saved. Check the waitlist before trying again.' : waitlistAlertMessage(e, 'Couldn’t save this change. Try again.');
            }
        }
        finally {
            state.busy = false;
            publish();
            // A return to this mounted route during dispatch skipped its focus read.
            // Reconcile before exposing controls for that new visit.
            if (!valid() && owner.current === state && state.visit && latest.current.isCurrent())
                void readRef.current();
        }
    };
    return { data: state.data, error: state.error, accessError: state.accessError, loading: state.loading, busy: state.busy, attempt: state.attempt,
        canAct: !!state.data && !state.data.ended && !state.error && !state.loading && !state.busy && !state.attempt,
        refresh, grant: (userId: string) => perform({ kind: 'grant', userId }), setClosed: (closed: boolean) => perform({ kind: 'pause', closed }),
        retry: () => state.attempt?.phase === 'failed' ? perform(state.attempt.action, true) : refresh() };
}
