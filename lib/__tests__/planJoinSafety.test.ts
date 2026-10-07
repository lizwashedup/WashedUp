import { classifyPlanJoinReceipt, joinErrorSurface, type PlanJoinRpc } from '../planJoinSafety';

describe('classifyPlanJoinReceipt', () => {
  const rpcs: PlanJoinRpc[] = ['join_event_atomic', 'join_circle_plan_atomic'];

  test.each(rpcs)('%s confirms only the exact joined receipt', (rpc) => {
    expect(classifyPlanJoinReceipt('joined', rpc)).toEqual({ kind: 'joined' });
  });

  test.each([
    ['join_event_atomic', 'full'],
    ['join_event_atomic', 'not_found'],
    ['join_event_atomic', 'waitlist_priority'],
    ['join_circle_plan_atomic', 'full'],
    ['join_circle_plan_atomic', 'not_found'],
    ['join_circle_plan_atomic', 'not_eligible'],
    ['join_circle_plan_atomic', 'not_circle_plan'],
  ] as const)('%s preserves its confirmed %s denial', (rpc, reason) => {
    expect(classifyPlanJoinReceipt(reason, rpc)).toEqual({ kind: 'denied', reason });
  });

  test.each(rpcs)('%s leaves malformed, missing, and unsupported receipts unknown', (rpc) => {
    const values: unknown[] = [
      null, undefined, '', ' ', true, false, 0, 1,
      'Joined', ' joined', 'joined ', 'joined\n',
      'already_joined', 'already_member', 'success', 'ok', 'future_receipt',
      { status: 'joined' }, { data: 'joined' }, ['joined'], [],
    ];
    for (const value of values) {
      expect(classifyPlanJoinReceipt(value, rpc)).toEqual({ kind: 'unknown' });
    }
  });

  test('does not treat receipts from a different RPC contract as confirmed denials', () => {
    expect(classifyPlanJoinReceipt('not_eligible', 'join_event_atomic')).toEqual({ kind: 'unknown' });
    expect(classifyPlanJoinReceipt('not_circle_plan', 'join_event_atomic')).toEqual({ kind: 'unknown' });
    expect(classifyPlanJoinReceipt('waitlist_priority', 'join_circle_plan_atomic')).toEqual({ kind: 'unknown' });
  });
});

describe('plan join safety', () => {
  test('uses an inline error only while the join sheet is visible', () => {
    expect(joinErrorSurface(true)).toBe('inline');
    expect(joinErrorSurface(false)).toBe('alert');
  });
});
