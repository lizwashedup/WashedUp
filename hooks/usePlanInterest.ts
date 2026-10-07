import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getPlanLifecycle } from '../lib/planLifecycle';
import { parseCirclePlanContextReceipt } from './useCirclePlanContext';
import { logError } from '../lib/logger';
type Entry = {
    id: string;
    event_id: string;
    interested_user_id: string;
    status: 'active';
};
type Phase = 'pending' | 'failed' | 'unknown';
type Options = {
    eventId: string;
    viewerId: string | null;
    epoch: number;
    isCurrent: () => boolean;
    canSend: () => boolean;
};
type State = {
    entry: Entry | null;
    ready: boolean;
    loading: boolean;
    busy: boolean;
    phase: Phase | null;
    error: string | null;
    visit: object | null;
    revision: number;
};
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const rejected = new Set(['P0001', 'P0002', '42501', '23502', '23503', '23505', '23514', '22P02', '28000', '28P01', '42883', '42703', '42P01', '40001', '40P01']);
const fields = 'id,event_id,interested_user_id,status';
/** Future interest is separate from admission. Capacity, age and gender do
 * not decide it; current visibility, creator/member status and lifecycle do. */
export function usePlanInterest(options: Options) {
    const client = useQueryClient(), latest = useRef(options);
    latest.current = options;
    const state = useMemo<State>(() => ({ entry: null, ready: false, loading: true, busy: false, phase: null, error: null, visit: null, revision: 0 }), [options.eventId, options.viewerId, options.epoch]);
    const owner = useRef(state);
    owner.current = state;
    const [, redraw] = useState(0);
    const publish = () => { if (owner.current === state && state.visit && latest.current.isCurrent())
        redraw(n => n + 1); };
    const capture = () => { const visit = state.visit; return () => !!visit && state.visit === visit && owner.current === state && options.isCurrent(); };
    const invalidate = () => { for (const queryKey of [['events', 'my-interest', options.eventId, options.viewerId], ['events', 'creator-interest', options.eventId]])
        void Promise.resolve(client.invalidateQueries({ queryKey })).catch(e => logError(e, 'plan.interest.refresh')); };
    const authenticate = async (valid: () => boolean) => { const r = await supabase.auth.getUser(); if (!valid())
        return false; if (r.error || !options.viewerId || r.data.user?.id !== options.viewerId)
        throw new Error('Account unavailable'); return true; };
    const read = async (valid: () => boolean): Promise<Entry | null | undefined> => {
        const r = await supabase.from('event_interest_signals').select(fields).eq('event_id', options.eventId).eq('interested_user_id', options.viewerId!).eq('status', 'active').maybeSingle();
        if (!valid())
            return undefined;
        if (r.error !== null)
            throw new Error('Interest unavailable');
        if (r.data === null)
            return null;
        const row = r.data;
        if (!row || !uuid(row.id) || row.event_id !== options.eventId || row.interested_user_id !== options.viewerId || row.status !== 'active')
            throw new Error('Interest unavailable');
        return row;
    };
    const refresh = async () => {
        if (!options.viewerId || !state.visit || !options.isCurrent() || state.busy)
            return;
        const visit = capture(), revision = ++state.revision, valid = () => visit() && state.revision === revision;
        state.loading = true;
        state.error = null;
        publish();
        try {
            if (!await authenticate(valid))
                return;
            const row = await read(valid);
            if (!valid() || row === undefined)
                return;
            state.entry = row;
            state.ready = true;
            if (row) {
                state.phase = null;
                invalidate();
            }
            else if (state.phase === 'unknown')
                state.error = 'We still can’t confirm your interest. Check again in a moment.';
        }
        catch {
            if (valid()) {
                state.ready = false;
                state.error = 'Couldn’t check your interest. Try again.';
            }
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
    const send = async (retry = false) => {
        if (!options.viewerId || !state.visit || !options.isCurrent() || !latest.current.canSend() || !state.ready || state.loading || state.busy || state.entry)
            return;
        if (state.phase && (!retry || state.phase !== 'failed'))
            return;
        const valid = capture();
        state.phase = 'pending';
        state.busy = true;
        state.error = null;
        state.revision++;
        publish();
        let dispatched = false;
        try {
            if (!await authenticate(valid))
                return;
            const existing = await read(valid);
            if (!valid() || existing === undefined)
                return;
            if (existing) {
                state.entry = existing;
                state.phase = null;
                invalidate();
                return;
            }
            const r = await supabase.from('events').select('id,creator_user_id,status,start_time,end_time,circle_id').eq('id', options.eventId).maybeSingle();
            if (!valid())
                return;
            const p = r.data;
            if (r.error !== null || !p || p.id !== options.eventId || typeof p.creator_user_id !== 'string' || typeof p.status !== 'string' || typeof p.start_time !== 'string' || !Number.isFinite(Date.parse(p.start_time)) || (p.end_time !== null && (typeof p.end_time !== 'string' || !Number.isFinite(Date.parse(p.end_time)))) || (p.circle_id !== null && !uuid(p.circle_id)))
                throw new Error('Plan unavailable');
            if (p.creator_user_id === options.viewerId || getPlanLifecycle({ status: p.status, startTime: p.start_time, endTime: p.end_time }).isClosed)
                throw new Error('Interest unavailable');
            const membership = await supabase.from('event_members').select('event_id,user_id,status').eq('event_id', options.eventId).eq('user_id', options.viewerId).eq('status', 'joined').maybeSingle();
            if (!valid())
                return;
            if (membership.error !== null || membership.data !== null)
                throw new Error('Interest unavailable');
            if (p.circle_id !== null) {
                const context = await supabase.rpc('get_circle_plan_context', { p_event_id: options.eventId });
                if (!valid())
                    return;
                if (context.error !== null)
                    throw new Error('Circle unavailable');
                const circle = parseCirclePlanContextReceipt(context.data, p.circle_id);
                if (circle.circle_visibility !== 'open' && !circle.viewer_is_member)
                    throw new Error('Private Circle');
            }
            if (!valid() || !latest.current.canSend())
                return;
            dispatched = true;
            const result = await supabase.rpc('send_interest_signal', { p_event_id: options.eventId });
            if (result.error && rejected.has(String(result.error.code))) {
                dispatched = false;
                throw result.error;
            }
            if (result.error !== null || !uuid(result.data))
                throw new Error('Unconfirmed interest');
            state.entry = { id: result.data, event_id: options.eventId, interested_user_id: options.viewerId, status: 'active' };
            state.ready = true;
            state.phase = null;
            if (owner.current === state && latest.current.isCurrent())
                invalidate();
        }
        catch {
            state.phase = dispatched ? 'unknown' : 'failed';
            state.error = dispatched ? 'Your interest may be saved. Check before trying again.' : 'Couldn’t save your interest. Try again.';
        }
        finally {
            if (state.phase === 'pending')
                state.phase = null;
            state.busy = false;
            publish();
            if (!valid() && owner.current === state && state.visit && latest.current.isCurrent())
                void readRef.current();
        }
    };
    return { entry: state.entry, ready: state.ready, loading: state.loading, busy: state.busy, phase: state.phase, error: state.error, refresh, send: () => send(), retry: () => state.phase === 'failed' ? send(true) : refresh() };
}
