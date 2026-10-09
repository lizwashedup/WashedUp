import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useChatComposerDraft } from '../useChatComposerDraft';
import type { ChatDraftAttempt } from '../../lib/chatComposerDraft';

jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
let current = true;
const owner = { userId: 'storage-owner', isCurrent: () => current };
const room = { kind: 'event' as const, id: 'storage-preflight-room' };
let hook: ReturnType<typeof useChatComposerDraft>;
let tree: ReactTestRenderer | undefined;
function Harness({ scope = owner }: { scope?: typeof owner }) { hook = useChatComposerDraft(room, scope); return null; }
async function flush() { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); }); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(async () => { current = true; await AsyncStorage.clear(); jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => { act(() => tree?.unmount()); tree = undefined; jest.clearAllTimers(); jest.useRealTimers(); });

it('releases a stalled prepare without transport, preserves newer text and the same UUID through ordered-storage recovery', async () => {
  await act(async () => { tree = create(<Harness />); });
  await act(async () => hook.change({ text: 'Original message' })); await flush();
  const blockedWrite = deferred();
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce((key, value) => blockedWrite.promise.then(() => write(key, value)));
  const transport = jest.fn(); let failure: unknown; let finished = false;
  let sending!: Promise<void>;
  act(() => { sending = hook.prepare().then(transport).catch(error => { failure = error; }).then(() => { finished = true; }); });
  await flush();
  const original = hook.draft.attempt!;
  expect(original.text).toBe('Original message'); expect(original.id).toBeTruthy();
  try {
    // A later edit queues after the attempt write; it must not disappear when
    // the older prepare waiter times out.
    await act(async () => hook.change({ text: 'Newer typing' })); await flush();
    const writesWhileBlocked = jest.mocked(AsyncStorage.setItem).mock.calls.length;
    await act(async () => jest.advanceTimersByTime(12000)); await flush();
    expect(finished).toBe(true); await sending;
    expect(failure).toMatchObject({ name: 'RequestDeadlineError' });
    expect(transport).not.toHaveBeenCalled();
    expect(hook.error).toBe(true);
    expect(hook.draft).toMatchObject({ text: 'Newer typing', attempt: original });
    await expect(hook.prepare()).rejects.toThrow('Check your saved message first');
    // Recovery cannot skip the unknown write or replace it with an empty draft.
    let recovery!: Promise<void>; act(() => { recovery = hook.retry(); });
    await flush(); await act(async () => jest.advanceTimersByTime(12000)); await flush(); await recovery;
    expect(jest.mocked(AsyncStorage.setItem).mock.calls).toHaveLength(writesWhileBlocked);
    expect(hook.error).toBe(true); expect(hook.draft.attempt).toEqual(original);
    blockedWrite.resolve(); await flush();
    await act(async () => hook.retry());
    expect(hook.error).toBe(false); expect(hook.draft).toMatchObject({ text: 'Newer typing', attempt: original });
    let retried!: ChatDraftAttempt;
    await act(async () => { retried = await hook.prepare(); transport(retried); });
    expect(retried).toEqual(original); expect(transport).toHaveBeenCalledTimes(1);
    await act(async () => hook.finish(retried));
    expect(hook.draft.text).toBe('Newer typing'); expect(hook.draft.attempt).toBeNull();
  } finally { blockedWrite.resolve(); await flush(); await sending; }
});

it('does not publish an old prepare timeout or late storage completion into another account', async () => {
  await act(async () => { tree = create(<Harness />); });
  await act(async () => hook.change({ text: 'Private first-account draft' })); await flush();
  const blockedWrite = deferred();
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce((key, value) => blockedWrite.promise.then(() => write(key, value)));
  const transport = jest.fn(); let pending!: Promise<unknown>;
  act(() => { pending = hook.prepare().then(transport).catch(error => error); }); await flush();
  try {
    const other = { userId: 'new-storage-owner', isCurrent: () => true };
    await act(async () => { tree!.update(<Harness scope={other} />); }); await flush();
    await act(async () => hook.change({ text: 'New account words' })); await flush();
    await act(async () => jest.advanceTimersByTime(12000)); await flush();
    expect(await pending).toMatchObject({ name: 'RequestDeadlineError' });
    expect(transport).not.toHaveBeenCalled();
    expect(hook.error).toBe(false); expect(hook.draft).toMatchObject({ text: 'New account words', attempt: null });
    blockedWrite.resolve(); await flush();
    expect(hook.error).toBe(false); expect(hook.draft).toMatchObject({ text: 'New account words', attempt: null });
  } finally { blockedWrite.resolve(); await flush(); await pending; }
});


it('releases a confirmed send when clearing its saved attempt stalls, without restoring sent text or losing newer typing', async () => {
  await act(async () => { tree = create(<Harness />); });
  await act(async () => hook.change({ text: 'Already delivered' })); await flush();
  let original!: ChatDraftAttempt;
  await act(async () => { original = await hook.prepare(); });
  const blockedWrite = deferred();
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce((key, value) => blockedWrite.promise.then(() => write(key, value)));
  const reportSendFailure = jest.fn(); let finished = false; let finishing!: Promise<void>;
  act(() => { finishing = hook.finish(original).catch(reportSendFailure).then(() => { finished = true; }); });
  await flush();
  expect(hook.draft.text).toBe(''); expect(hook.draft.attempt).toBeNull();
  try {
    await act(async () => hook.change({ text: 'New message after delivery' })); await flush();
    await act(async () => jest.advanceTimersByTime(12000)); await flush();
    expect(finished).toBe(true); await finishing;
    expect(reportSendFailure).not.toHaveBeenCalled();
    expect(hook.error).toBe(true);
    expect(hook.draft).toMatchObject({ text: 'New message after delivery', attempt: null });
    await expect(hook.prepare()).rejects.toThrow('Check your saved message first');
    blockedWrite.resolve(); await flush();
    await act(async () => hook.retry());
    expect(hook.error).toBe(false); expect(hook.draft).toMatchObject({ text: 'New message after delivery', attempt: null });
    let next!: ChatDraftAttempt;
    await act(async () => { next = await hook.prepare(); });
    expect(next.text).toBe('New message after delivery'); expect(next.id).not.toBe(original.id);
    await act(async () => hook.finish(next));
  } finally { blockedWrite.resolve(); await flush(); await finishing; }
});

it('does not turn a delivered message into a send failure when the storage clear rejects', async () => {
  await act(async () => { tree = create(<Harness />); });
  await act(async () => hook.change({ text: 'Delivered before storage failure' })); await flush();
  let original!: ChatDraftAttempt;
  await act(async () => { original = await hook.prepare(); });
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(Error('Storage unavailable'));
  await act(async () => { await expect(hook.finish(original)).resolves.toBeUndefined(); });
  expect(hook.error).toBe(true); expect(hook.draft).toMatchObject({ text: '', attempt: null });
  await act(async () => hook.retry());
  expect(hook.error).toBe(false); expect(hook.draft).toMatchObject({ text: '', attempt: null });
});


it('does not publish a confirmed-send storage timeout into a different account', async () => {
  await act(async () => { tree = create(<Harness />); });
  await act(async () => hook.change({ text: 'Delivered in original account' })); await flush();
  let original!: ChatDraftAttempt;
  await act(async () => { original = await hook.prepare(); });
  const blockedWrite = deferred();
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce((key, value) => blockedWrite.promise.then(() => write(key, value)));
  let finishing!: Promise<void>; act(() => { finishing = hook.finish(original); }); await flush();
  try {
    const other = { userId: 'another-finish-owner', isCurrent: () => true };
    await act(async () => { tree!.update(<Harness scope={other} />); }); await flush();
    await act(async () => hook.change({ text: 'Other account draft' })); await flush();
    await act(async () => jest.advanceTimersByTime(12000)); await flush(); await finishing;
    expect(hook.error).toBe(false); expect(hook.draft).toMatchObject({ text: 'Other account draft', attempt: null });
    blockedWrite.resolve(); await flush();
    expect(hook.error).toBe(false); expect(hook.draft).toMatchObject({ text: 'Other account draft', attempt: null });
  } finally { blockedWrite.resolve(); await flush(); await finishing; }
});

it('surfaces a stalled ordinary draft save and recovers the same words before sending is enabled', async () => {
  await act(async () => { tree = create(<Harness />); });
  const blockedWrite = deferred();
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce((key, value) => blockedWrite.promise.then(() => write(key, value)));
  await act(async () => hook.change({ text: 'Words awaiting storage' })); await flush();
  try {
    await act(async () => jest.advanceTimersByTime(12000)); await flush();
    expect(hook.error).toBe(true); expect(hook.draft).toMatchObject({ text: 'Words awaiting storage', attempt: null });
    await expect(hook.prepare()).rejects.toThrow('Check your saved message first');
    blockedWrite.resolve(); await flush(); await act(async () => hook.retry());
    expect(hook.error).toBe(false); expect(hook.draft).toMatchObject({ text: 'Words awaiting storage', attempt: null });
  } finally { blockedWrite.resolve(); await flush(); }
});

it('detaches before a slow storage write and preserves identical next typing across a saved reload', async () => {
  await act(async () => { tree = create(<Harness />); });
  await act(async () => hook.change({ text: 'Hello' })); await flush();
  const blockedWrite = deferred(); const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce((key, value) => blockedWrite.promise.then(() => write(key, value)));
  const transport = jest.fn(); let preparing!: Promise<ChatDraftAttempt>;
  act(() => { preparing = hook.prepare({detachText:true}).then(value => { transport(); return value; }); }); await flush();
  expect(hook.draft.text).toBe(''); expect(hook.draft.attempt?.text).toBe('Hello'); expect(transport).not.toHaveBeenCalled();
  await act(async () => hook.change({text:'Hello'}));
  blockedWrite.resolve(); await flush(); const original = await preparing;
  expect(transport).toHaveBeenCalledTimes(1);
  await act(async () => hook.retry()); // Reload the serialized distinction, not just in-memory state.
  await act(async () => hook.finish(original));
  expect(hook.draft.text).toBe('Hello'); expect(hook.draft.attempt).toBeNull();
});

it('preserves an identical revision made during reply validation without clearing its native editor',async()=>{
 const checking=deferred();const library=require('../../lib/chatComposerDraft');
 const verify=jest.spyOn(library,'verifyChatComposerTarget').mockReturnValue(checking.promise);
 try{
  await act(async()=>{tree=create(<Harness/>);});await act(async()=>hook.change({text:'Hello',reply:{id:'parent',content:'Parent',senderName:'Amelia'}}));await flush();
  const clear=jest.fn();let preparing!:Promise<ChatDraftAttempt>;
  act(()=>{preparing=hook.prepare({detachText:true,onDetach:clear});});
  await act(async()=>hook.change({text:'Hello'}));
  checking.resolve();await flush();const original=await preparing;
  expect(clear).not.toHaveBeenCalled();
  await act(async()=>hook.finish(original));expect(hook.draft.text).toBe('Hello');
 }finally{verify.mockRestore();}
});

it('keeps a newer durably saved draft usable when the original preparation write rejects', async () => {
  await act(async () => { tree = create(<Harness />); });
  await act(async () => hook.change({ text: 'Original awaiting storage' })); await flush();
  let reject!: (error: Error) => void;
  const blocked = new Promise<void>((_yes, no) => { reject = no; });
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(() => blocked);
  const transport = jest.fn(); let failure: unknown;
  let preparing!: Promise<void>;
  act(() => { preparing = hook.prepare({ detachText: true }).then(transport).catch(error => { failure = error; }); });
  await flush();
  const original = hook.draft.attempt!;
  await act(async () => hook.change({ text: 'Next words safely queued' })); await flush();
  await act(async () => { reject(Error('Original write failed')); await preparing; }); await flush();
  expect(failure).toBeInstanceOf(Error);
  expect(transport).not.toHaveBeenCalled();
  expect(hook.draft).toMatchObject({ text: 'Next words safely queued', attempt: original });
  const saved = await jest.requireActual('../../lib/chatComposerDraft').readChatComposer(room, owner);
  expect(saved.unsaved).toBe(false);
  expect(saved.draft).toMatchObject({ text: 'Next words safely queued', attempt: original });
  expect(hook.error).toBe(false);
  let retry!: ChatDraftAttempt;
  await act(async () => { retry = await hook.prepare({detachText:true}); });
  expect(retry.id).toBe(original.id);
  expect(hook.draft.text).toBe('Next words safely queued');
});
