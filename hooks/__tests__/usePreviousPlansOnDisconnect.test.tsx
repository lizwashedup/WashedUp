import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { usePreviousPlansOnDisconnect } from '../usePreviousPlansOnDisconnect';
import type { Plan } from '../../lib/fetchPlans';

type Args = Parameters<typeof usePreviousPlansOnDisconnect>;
const rows = [{id:'picnic'}] as Plan[];
const alice = () => true;
const offline = new Error('TypeError: Network request failed');
let show: boolean, tree: ReactTestRenderer;
function List({args}: {args: Args}) { show = usePreviousPlansOnDisconnect(...args); return null; }
function update(...args: Args) { act(() => tree.update(<List args={args}/>)); }
beforeEach(() => { act(() => {tree = create(<List args={['success', rows, null, alice, 'all']}/>);}); });
afterEach(() => act(() => tree.unmount()));

it('keeps the last displayed rows through interrupted retries until the feed recovers', () => {
  update('error', rows, offline, alice, 'all');
  expect(show).toBe(true);
  update('error', rows, new Error('feed timed out after 15000ms'), alice, 'all');
  expect(show).toBe(true);
  update('success', [{id:'walk'}] as Plan[], null, alice, 'all');
  expect(show).toBe(false);
});
it('retires a denied snapshot even if the next retry disconnects', () => {
  update('error', rows, new Error('not authenticated'), alice, 'all');
  expect(show).toBe(false);
  update('error', rows, offline, alice, 'all');
  expect(show).toBe(false);
});
it('requires a successful result from the active account and geographic filter', () => {
  update('error', rows, offline, () => true, 'all');
  expect(show).toBe(false);
  update('success', rows, null, alice, 'all');
  update('error', rows, offline, alice, 'near:34,-118,5');
  expect(show).toBe(false);
});
it('keeps cold, reset and empty results out of the retained-list state', () => {
  update('pending', undefined, null, alice, 'all');
  update('error', rows, offline, alice, 'all');
  expect(show).toBe(false);
  const empty: Plan[] = [];
  update('success', empty, null, alice, 'all');
  update('error', empty, offline, alice, 'all');
  expect(show).toBe(false);
});
