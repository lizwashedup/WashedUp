import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Linking } from 'react-native';
const mockResume = jest.fn(), mockStash = jest.fn();
jest.mock('../../../lib/resumeTicketCheckout', () => ({ resumeTicketCheckout: (...args: unknown[]) => mockResume(...args) }));
jest.mock('../../../lib/pendingLink', () => ({ stashPendingCheckout: (...args: unknown[]) => mockStash(...args) }));
import { PendingCheckoutActions } from '../PendingCheckoutActions';
const id = 'order-original'; let tree: ReactTestRenderer;
const owner = { userId: 'buyer', isCurrent: () => true };
const press = (label: string) => tree.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0].props.onPress();
beforeEach(() => { jest.clearAllMocks(); mockResume.mockResolvedValue({ kind: 'checkout', orderId: id, url: 'https://checkout.stripe.com/original' }); mockStash.mockResolvedValue(undefined); jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined); });
afterEach(() => { if (tree) act(() => tree.unmount()); jest.restoreAllMocks(); });
async function render(opts: Partial<React.ComponentProps<typeof PendingCheckoutActions>> = {}) { const refresh = jest.fn().mockResolvedValue(undefined); await act(async () => { tree = create(<PendingCheckoutActions orderId={id} owner={owner} onRefresh={refresh} {...opts} />); }); return refresh; }
it('stashes the exact order before opening its existing payment URL', async () => {
  await render(); await act(async () => press('Continue payment'));
  expect(mockStash).toHaveBeenCalledWith(id, true); expect(Linking.openURL).toHaveBeenCalledWith('https://checkout.stripe.com/original');
  expect(mockStash.mock.invocationCallOrder[0]).toBeLessThan((Linking.openURL as jest.Mock).mock.invocationCallOrder[0]);
});
it('storage failure leaves payment unopened and shows recoverable copy', async () => {
  mockStash.mockRejectedValue(Error('storage')); await render(); await act(async () => press('Continue payment'));
  expect(Linking.openURL).not.toHaveBeenCalled(); expect(JSON.stringify(tree.toJSON())).toContain('original purchase is saved');
});
it('retired visit after response cannot persist or open payment', async () => {
  let current = true; mockResume.mockImplementation(async () => { current = false; return { kind: 'checkout', orderId: id, url: 'https://checkout.stripe.com/a' }; });
  await render({ owner: { ...owner, isCurrent: () => current } }); await act(async () => press('Continue payment')); expect(mockStash).not.toHaveBeenCalled(); expect(Linking.openURL).not.toHaveBeenCalled();
});
it('double tap dispatches only one resume while transport is pending', async () => {
  let finish!: (v: unknown) => void; mockResume.mockImplementation(() => new Promise(resolve => { finish = resolve; })); await render();
  await act(async () => { press('Continue payment'); press('Continue payment'); }); expect(mockResume).toHaveBeenCalledTimes(1);
  await act(async () => finish({ kind: 'error', message: 'still checking' })); expect(Linking.openURL).not.toHaveBeenCalled();
});
it('updated order refreshes its status without opening a browser', async () => {
  mockResume.mockResolvedValue({ kind: 'updated', orderId: id }); const refresh = await render(); await act(async () => press('Continue payment'));
  expect(refresh).toHaveBeenCalledTimes(1); expect(mockStash).not.toHaveBeenCalled(); expect(Linking.openURL).not.toHaveBeenCalled();
});
it('check status is read-only and offers retry after refresh fails', async () => {
  const refresh = jest.fn().mockRejectedValue(Error('offline')); await render({ onRefresh: refresh }); await act(async () => press('Check status'));
  expect(mockResume).not.toHaveBeenCalled(); expect(JSON.stringify(tree.toJSON())).toContain('could not be refreshed');
});
it('failed browser launch retains the purchase pointer and displays retry', async () => {
  (Linking.openURL as jest.Mock).mockRejectedValue(Error('cannot open')); await render(); await act(async () => press('Continue payment'));
  expect(mockStash).toHaveBeenCalledTimes(1); expect(JSON.stringify(tree.toJSON())).toContain('try again');
});
