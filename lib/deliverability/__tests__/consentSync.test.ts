import { requestResendAudienceSync } from '../consentSync';

describe('requestResendAudienceSync', () => {
  it.each([
    { label: 'opted in with an email', marketingOptIn: true, email: 'person@example.com' },
    { label: 'opted out with an email', marketingOptIn: false, email: 'person@example.com' },
    { label: 'opted out with no email', marketingOptIn: false, email: null },
  ])('invokes the sync for $label', ({ marketingOptIn, email }) => {
    const invoke = jest.fn(() => Promise.resolve({ marketingOptIn, email }));

    requestResendAudienceSync(invoke);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not make the caller await the sync or surface a rejected request', async () => {
    const error = new Error('network unavailable');
    const onError = jest.fn();
    const invoke = jest.fn(() => Promise.reject(error));

    requestResendAudienceSync(invoke, onError);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
  });
});
