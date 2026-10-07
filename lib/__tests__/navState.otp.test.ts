describe('OTP resend reuse boundary', () => {
  it('stops reusing the prior send when the 30-second resend button unlocks', () => {
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);

    jest.isolateModules(() => {
      const { markOtpSent, wasOtpRecentlySent } = require('../navState') as typeof import('../navState');
      const phone = '+12135550101';

      markOtpSent(phone);
      now += 29_999;
      expect(wasOtpRecentlySent(phone)).toBe(true);

      now += 1;
      expect(wasOtpRecentlySent(phone)).toBe(false);
    });

    nowSpy.mockRestore();
  });
});
