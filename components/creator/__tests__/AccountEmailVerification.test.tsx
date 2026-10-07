import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';
const mockLoad = jest.fn(), mockSend = jest.fn();
jest.mock('../../../lib/accountEmail', () => ({
  ...jest.requireActual('../../../lib/accountEmailContract'),
  accountEmail: { load: (...args: unknown[]) => mockLoad(...args), requestLink: (...args: unknown[]) => mockSend(...args) },
}));
import { AccountEmailFailure } from '../../../lib/accountEmailContract';
import { AccountEmailVerification } from '../AccountEmailVerification';
let tree: ReactTestRenderer, active: boolean;
const original = { userId: 'creator', email: null, verified: false, pendingEmail: null, sentAt: null };
const pending = { ...original, pendingEmail: 'creator@example.com', sentAt: '2026-09-17T00:00:00Z' };
const returnUrl = 'http://127.0.0.1:3000/email-confirmation';
let scope: { userId: string; isCurrent(): boolean };
const render = (extra = {}) => <AccountEmailVerification scope={scope} returnUrl={returnUrl} initiallyOpen {...extra}/>;
const text = () => JSON.stringify(tree.toJSON());
const button = (label: string) => tree.root.findAllByType(TouchableOpacity).find(x => x.findAllByType(Text).some(t => t.props.children === label))!;
const enter = async () => { await act(async () => tree.root.findByType(TextInput).props.onChangeText('creator@example.com')); };
beforeEach(() => { jest.clearAllMocks(); active = true; scope = { userId: 'creator', isCurrent: () => active }; mockLoad.mockResolvedValue(original); mockSend.mockResolvedValue(pending); });
afterEach(() => act(() => tree?.unmount()));
it('stays collapsed until requested, then explicitly sends and distinguishes pending from verified', async () => {
  await act(async () => { tree = create(render({ initiallyOpen: false })); }); expect(mockLoad).not.toHaveBeenCalled();
  await act(async () => button('Verify email').props.onPress()); await enter();
  await act(async () => button('Send link').props.onPress());
  expect(mockSend).toHaveBeenCalledWith('creator@example.com', scope, returnUrl, false);
  expect(text()).toContain('Open the verification link'); expect(text()).not.toContain('Your account email is verified.');
  await act(async () => button('Resend link').props.onPress()); expect(mockSend.mock.calls[1][3]).toBe(true);
});
it('recovers a lost request by reading, with no duplicate send or false verification', async () => {
  await act(async () => { tree = create(render()); }); await enter();
  mockSend.mockRejectedValueOnce(new AccountEmailFailure('unknown', 'Check its status before trying again.'));
  await act(async () => button('Send link').props.onPress());
  expect(button('Send link').props.disabled).toBe(true); expect(tree.root.findByType(TextInput).props.editable).toBe(false);
  mockLoad.mockResolvedValue(pending); await act(async () => button('Check status').props.onPress());
  expect(button('Resend link').props.disabled).toBe(false); expect(mockSend).toHaveBeenCalledTimes(1);
});
it('failed initial reads remain recoverable and never offer sending without account evidence', async () => {
  mockLoad.mockRejectedValueOnce(Error('Offline')); await act(async () => { tree = create(render()); });
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0); expect(text()).toContain('Could not check');
  await act(async () => button('Check status').props.onPress()); expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
});
it('does not send with an unconfigured return address', async () => {
  await act(async () => { tree = create(render({ returnUrl: '' })); });
  expect(text()).toContain('not available in this build'); expect(button('Send link')).toBeUndefined(); expect(mockSend).not.toHaveBeenCalled();
});
it('keeps one request in flight despite repeated callbacks', async () => {
  await act(async () => { tree = create(render()); }); await enter(); let finish: any;
  mockSend.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const send = button('Send link').props.onPress;
  act(() => { send(); send(); }); expect(mockSend).toHaveBeenCalledTimes(1);
  await act(async () => finish(pending)); expect(text()).toContain('Open the verification link');
});
it('never publishes a retired account result into a new account', async () => {
  let finish: any; mockLoad.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { tree = create(render()); }); active = false; scope = { userId: 'other', isCurrent: () => true };
  mockLoad.mockResolvedValue({ ...original, userId: 'other' }); await act(async () => { tree.update(render()); finish({ ...original, email: 'old@example.com', verified: true }); });
  expect(text()).not.toContain('old@example.com'); expect(text()).not.toContain('Your account email is verified.');
});
it('reports confirmed email once even when parent refresh supplies a new callback', async () => {
  mockLoad.mockResolvedValue({ ...original, email: 'creator@example.com', verified: true }); const notified = jest.fn();
  await act(async () => { tree = create(render({ onVerified: () => notified() })); });
  await act(async () => tree.update(render({ onVerified: () => notified() })));
  expect(notified).toHaveBeenCalledTimes(1); expect(tree.root.findAllByType(TextInput)).toHaveLength(0); expect(mockSend).not.toHaveBeenCalled();
});
