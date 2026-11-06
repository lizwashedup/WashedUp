// Both the personal list and a removal preflight must distinguish an empty
// result from a response that cannot identify all of the member's plans.
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function isInterestId(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

type InterestRow = { event_id: string; signal_id?: unknown };
export function interestSignalList(value: unknown): InterestRow[] | null {
  return Array.isArray(value) && value.every(row => row && isInterestId(row.event_id))
    ? value : null;
}
