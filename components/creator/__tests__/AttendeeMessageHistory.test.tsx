import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockLoad = jest.fn();
jest.mock('../../../lib/attendeeMessageHistory', () => ({ AttendeeMessageHistoryDenied: class extends Error {}, loadAttendeeMessageHistory: (...a: unknown[]) => mockLoad(...a) }));
jest.mock('expo-router', () => ({ router: {}, Stack: { Screen: () => null } }));
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: { regular: 'System', semibold: 'System' } }) }));
import { AttendeeMessageHistoryDenied } from '../../../lib/attendeeMessageHistory';
import { AttendeeMessageHistory } from '../AttendeeMessageHistory';
const first = { id: 'one', event_id: 'event', subject: 'Sunday update', body: 'Original full message', created_at: '2026-09-16T17:00:00Z', queued_at: '2026-09-16T17:00:00Z', recipient_count: 2 };
const second = { ...first, id: 'two', subject: 'Earlier update', body: 'Earlier complete message' };
const cursor = { id: first.id, created_at: first.created_at };
const scope = { userId: 'member', isCurrent: () => true };
let tree: ReactTestRenderer;
const render = (owned = scope) => <AttendeeMessageHistory eventId="event" scope={owned} />;
const text = (value: string) => tree.root.findAll(v => v.props.children === value).length > 0;
const press = (label: string) => tree.root.findAll(v => v.props.accessibilityLabel === label && typeof v.props.onPress === 'function')[0].props.onPress();
beforeEach(() => { jest.clearAllMocks(); mockLoad.mockResolvedValue({ rows: [first], next: cursor }); });
afterEach(() => { if (tree) act(() => tree.unmount()); });
it('expands saved full text and reads earlier pages without replacing the current rows', async () => {
  await act(async () => { tree = create(render()); }); expect(text(first.body)).toBe(false);
  act(() => press('Read Sunday update')); expect(text(first.body)).toBe(true);
  mockLoad.mockResolvedValueOnce({ rows: [second], next: null }); await act(async () => press('Earlier updates'));
  expect(mockLoad).toHaveBeenLastCalledWith('event', scope, cursor); expect(text(first.subject)).toBe(true); expect(text(second.subject)).toBe(true); expect(text(first.body)).toBe(true);
});
it('keeps the current page and reading expansion when an earlier-page read fails', async () => {
  await act(async () => { tree = create(render()); }); act(() => press('Read Sunday update'));
  mockLoad.mockRejectedValueOnce(Error('Offline')); await act(async () => press('Earlier updates'));
  expect(text(first.body)).toBe(true); mockLoad.mockResolvedValueOnce({ rows: [second], next: null }); await act(async () => press('Try again'));
  expect(text(second.subject)).toBe(true);
});
it('drops private rows and ignores a late page for the previous account', async () => {
  await act(async () => { tree = create(render()); });
  let resolve: any; mockLoad.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => press('Earlier updates'));
  mockLoad.mockResolvedValueOnce({ rows: [], next: null });
  await act(async () => { tree.update(render({ userId: 'other', isCurrent: () => true })); resolve({ rows: [second], next: null }); });
  expect(text(first.subject)).toBe(false); expect(text(second.subject)).toBe(false);
});

it('hides previously readable history when the backend confirms access was revoked',async()=>{await act(async()=>{tree=create(render());});mockLoad.mockRejectedValueOnce(new AttendeeMessageHistoryDenied('Revoked'));await act(async()=>press('Earlier updates'));expect(text(first.subject)).toBe(false);expect(text('Event message access is no longer available.')).toBe(true);});
it('reuses the same compact rows for invitation history with its own labels',async()=>{
 const source=jest.fn().mockResolvedValue({rows:[{...first,subject:'Page followers'}],next:cursor});
 await act(async()=>{tree=create(<AttendeeMessageHistory eventId="event" scope={scope} invitation historyLoader={source}/>);});
 expect(mockLoad).not.toHaveBeenCalled();expect(text('Recent invitations')).toBe(true);act(()=>press('Read Page followers'));expect(text(first.body)).toBe(true);
 source.mockRejectedValueOnce(new AttendeeMessageHistoryDenied());await act(async()=>press('Earlier invitations'));expect(text(first.body)).toBe(false);expect(text('Invitation history access is no longer available.')).toBe(true);
});
