import { canSeeEventMoney } from '../event-money';

describe('canSeeEventMoney', () => {
  it('sees money when they can manage finance, regardless of event-host grant', () => {
    expect(canSeeEventMoney({ hasEventHostGrant: false }, true)).toBe(true);
  });

  it('sees money as a solo event host even without finance access', () => {
    expect(canSeeEventMoney({ hasEventHostGrant: true }, false)).toBe(true);
  });

  it('is blocked when neither finance access nor an event-host grant is present', () => {
    expect(canSeeEventMoney({ hasEventHostGrant: false }, false)).toBe(false);
  });

  it('is blocked when access has not loaded yet and finance is false', () => {
    expect(canSeeEventMoney(null, false)).toBe(false);
    expect(canSeeEventMoney(undefined, false)).toBe(false);
  });

  it('still allows finance-tier access before the event-host query resolves', () => {
    expect(canSeeEventMoney(null, true)).toBe(true);
  });
});
