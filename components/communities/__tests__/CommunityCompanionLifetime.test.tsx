import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('../../../lib/topicComposerDraft',()=>({...jest.requireActual('../../../lib/topicComposerDraft'),verifyTopicComposerTarget:jest.fn().mockResolvedValue(undefined),checkTopicComposerAttempt:jest.fn().mockResolvedValue(false)}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({top:0,bottom:34,left:0,right:0}) }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommunityRepliesPanel } from '../CommunityRepliesPanel';
import { CommunityMessageActions } from '../CommunityMessageActions';
import { BroadcastCard } from '../BroadcastCard';
import { ReactionChips } from '../../chat/ReactionChips';
import ReactionEmojiPicker from '../../chat/ReactionEmojiPicker';
import LinkifiedText from '../../LinkifiedText';
import Colors from '../../../constants/Colors';
import { ChatMentionPicker } from '../../chat/ChatMentionPicker';
import { getBroadcastReplyMembers } from '../../../lib/communityChat';
import { checkTopicComposerAttempt } from '../../../lib/topicComposerDraft';
import type { CommunityOperationScope } from '../../../lib/communityChat';

const mockReplySubscriptions: { event: string; filter: any; callback: (payload?: any) => void }[] = [];
jest.mock('../../../lib/supabase', () => ({ supabase: { realtime: { isDisconnecting: () => false }, channel: () => {
  const channel = { on: (event: string, filter: any, callback: any) => { mockReplySubscriptions.push({event, filter, callback}); return channel; }, subscribe: () => channel }; return channel;
}, removeChannel: jest.fn() } }));

const mockRead = jest.fn(), mockReply = jest.fn(), mockReact = jest.fn();
const mockSuccess = jest.fn(), mockError = jest.fn(), mockAddReaction = jest.fn();
const mockComposeIntro = jest.fn(), mockViewMember=jest.fn();
jest.mock('../../../lib/communityChat', () => ({
  getBroadcastReplyMembers: jest.fn().mockResolvedValue([]),
  getBroadcastReplies: async (...args: unknown[]) => {
    const value = await mockRead(...args);
    return Array.isArray(value) ? { replies: value, hasMore: false, olderCursor: null } : value;
  },
  sendBroadcastReply: (...args: unknown[]) => mockReply(...args),
  toggleBroadcastReaction: (...args: unknown[]) => mockReact(...args),
  composeIntroCard: (payload: unknown) => mockComposeIntro(payload),
  ObsoleteCommunityOperationError: class extends Error { constructor() { super('Obsolete'); this.name = 'ObsoleteCommunityOperationError'; } },
  isObsoleteCommunityOperation: (error: Error) => error?.name === 'ObsoleteCommunityOperationError',
}));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticSuccess: () => mockSuccess() }));
jest.mock('../../../lib/friendlyError', () => ({ friendlyError: (_error: unknown, fallback: string) => fallback }));
jest.mock('../../keyboard/KeyboardDoneBar', () => ({ KEYBOARD_DONE_ACCESSORY_ID: 'keyboard-done' }));
jest.mock('../../chat/ReactionEmojiPicker', () => () => null);
jest.mock('../../LinkifiedText', () => ({ __esModule: true, default: ({text}: {text:string}) => require('react').createElement(require('react-native').Text, null, text) }));

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe.each(['message', 'broadcast'] as const)('%s companion lifetime', kind => {
  let tree: ReactTestRenderer, client: QueryClient, invalidate: jest.SpyInstance;
  let epoch: number, scope: CommunityOperationScope | undefined, message: any;
  let delegatedReact: jest.Mock | undefined;
  let compactReplies = false, replyRequest: object | undefined;
  function nextScope(userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') {
    const captured = ++epoch;
    return { userId, isCurrent: () => captured === epoch };
  }
  function render() {
    // Cast until the additive optional props land; the reproduction uses the actual components.
    const Entry = (kind === 'message' ? CommunityMessageActions : BroadcastCard) as React.ComponentType<any>;
    return <QueryClientProvider client={client}><Entry
      compactReplies={compactReplies} replyRequest={replyRequest} message={message} broadcast={message} communityName="Sunset Club"
      scope={scope} onViewMember={mockViewMember} onError={mockError} onAddReaction={mockAddReaction} onReact={delegatedReact}
    /></QueryClientProvider>;
  }
  const replyToggle = () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Reply to this message')!;
  const input = () => tree.root.findByType(TextInput);
  const sendButton = () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Send reply')
    ?? tree.root.findAllByType(TouchableOpacity).find(node => node.props.disabled !== undefined && node.props.children?.props?.children === 'send')!;
  const recovery = (label: string) => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)!;
  function type(text: string) { act(() => input().props.onChangeText(text)); }
  async function showReplies() { await act(async () => { replyToggle().props.onPress(); }); }
  async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
  async function mount() { await act(async () => { tree = create(render()); }); }
  async function update() { await act(async () => tree.update(render())); }
  const visibleText = () => {
    const read = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(read).join(' ') : node?.children ? read(node.children) : '';
    return read(tree.toJSON());
  };

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks(); mockReplySubscriptions.length = 0; compactReplies=false;replyRequest=undefined; epoch = 0; scope = nextScope(); delegatedReact = undefined;
    message = { id: '11111111-1111-4111-8111-111111111111', kind: kind === 'message' ? 'message' : 'broadcast', body: 'Original message',
      reactions: [], reply_count: 0, created_at: '2026-09-13T12:00:00Z' };
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    invalidate = jest.spyOn(client, 'invalidateQueries');
    (checkTopicComposerAttempt as jest.Mock).mockReset().mockResolvedValue(false);
    (getBroadcastReplyMembers as jest.Mock).mockReset().mockResolvedValue([]);
    mockRead.mockResolvedValue([]); mockReply.mockResolvedValue(undefined); mockReact.mockResolvedValue(undefined);
    mockComposeIntro.mockReturnValue({ lead: 'Amelia joined us', qa: 'A preserved answer' });
  });
  afterEach(async () => { await act(async () => tree?.unmount()); client.clear(); });

  if (kind === 'message') {
    it('opens a menu-requested panel with no redundant empty reply link and keeps its draft on close',async()=>{
      compactReplies=true; await mount(); expect(replyToggle()).toBeUndefined();
      replyRequest={}; await update(); type('Keep this reply');
      act(()=>tree.root.findByType(CommunityRepliesPanel).props.onClose());
      expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
      await update(); expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
      replyRequest={}; await update(); expect(input().props.value).toBe('Keep this reply');
      const staleClose=tree.root.findByType(CommunityRepliesPanel).props.onClose;
      scope=nextScope('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); await update();
      expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
      replyRequest={}; await update();type('Bob draft');act(()=>staleClose());
      expect(input().props.value).toBe('Bob draft');
    });
    it('keeps outgoing mentions readable and dismisses replies before opening the selected profile', async () => {
      const selected='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      mockRead.mockResolvedValue([{id:'reply',sender_id:scope!.userId,body:'@Alex',created_at:'2026-09-20T12:00:00Z',mention_data:{version:1,text:'@Alex',references:[{userId:selected,label:'Alex',start:0,end:5}]}}]);
      await mount(); await showReplies(); await flush();
      const link=tree.root.findAllByType(LinkifiedText).find(node=>node.props.text==='@Alex')!;
      expect(StyleSheet.flatten(link.props.mentionStyle).color).toBe(Colors.white);
      act(()=>link.props.onMentionPress(selected));
      expect(tree.root.findByType(Modal).props.visible).toBe(false);
      expect(mockViewMember).not.toHaveBeenCalled();
      act(()=>tree.root.findByType(Modal).props.onDismiss());
      expect(mockViewMember).toHaveBeenCalledWith(selected);
      expect(tree.root.findAllByType(CommunityRepliesPanel)).toHaveLength(0);
    });
    it('retains a direct entry to existing reply history',async()=>{
      compactReplies=true;message.reply_count=2;await mount();
      const open=tree.root.findAllByType(TouchableOpacity).find(node=>node.props.accessibilityLabel==='View 2 replies')!;
      act(()=>open.props.onPress());expect(tree.root.findByType(CommunityRepliesPanel).props.message.id).toBe('11111111-1111-4111-8111-111111111111');
    });
    it('returns a stalled history read to retry without losing the typed reply',async()=>{
      jest.useFakeTimers();const pending=deferred<any[]>();mockRead.mockReturnValueOnce(pending.promise);
      try {
        await mount();await showReplies();type('Still here');
        await act(async()=>{await jest.advanceTimersByTimeAsync(12001);});
        expect(tree.root.findByType(CommunityRepliesPanel).props.error).toBe(true);
        expect(input().props.value).toBe('Still here');expect(mockRead.mock.calls[0][1].isCurrent()).toBe(false);
        await act(async()=>pending.resolve([{id:'late',body:'Late result'}]));
        expect(tree.root.findByType(CommunityRepliesPanel).props.replies).toHaveLength(0);
        mockRead.mockResolvedValueOnce([]);
        act(()=>tree.root.findByType(CommunityRepliesPanel).props.onRetry());
        await act(async()=>{await jest.advanceTimersByTimeAsync(1);});
        expect(tree.root.findByType(CommunityRepliesPanel).props.error).toBe(false);
        expect(input().props.value).toBe('Still here');
      } finally {jest.useRealTimers();}
    });
  }

  const olderReplies = () => kind === 'message'
    ? tree.root.findByType(CommunityRepliesPanel).props.onLoadOlder
    : tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Load earlier replies')!.props.onPress;
  const historyPage = (id:string,hasMore=false) => ({replies:[{id,body:id,sender_id:'other',created_at:`2026-09-25T10:00:0${id==='older'?1:2}Z`}],hasMore,olderCursor:{id,created_at:'2026-09-25T10:00:02Z'}});

  it('keeps earlier replies reachable when the newest page is entirely blocked',async()=>{
    mockRead.mockResolvedValue({...historyPage('hidden',true),replies:[]});
    await mount();await showReplies();await flush();type('My draft');
    expect(visibleText()).not.toContain('Be the first to reply.');
    expect(olderReplies()).toBeDefined();
    mockRead.mockResolvedValueOnce(historyPage('older'));
    await act(async()=>olderReplies()());await flush();
    expect(visibleText()).toContain('older');expect(input().props.value).toBe('My draft');
  });

  it('paged reply history keeps earlier rows and the draft when a new reply arrives',async()=>{
    mockRead.mockImplementation((_id,_scope,cursor)=>cursor ? historyPage('older') : historyPage('newest',true));
    await mount();await showReplies();await flush();type('Keep my words');
    await act(async()=>olderReplies()());await flush();
    expect(mockRead.mock.calls.some(call=>call[2]?.id==='newest')).toBe(true);
    expect(visibleText()).toContain('older');expect(visibleText()).toContain('newest');
    mockRead.mockImplementation((_id,_scope,cursor)=>cursor ? historyPage('older') : {
      ...historyPage('newest',true),replies:[...historyPage('newest').replies,{id:'latest',body:'A fresh reply',sender_id:'other',created_at:'2026-09-25T10:00:03Z'}]});
    const listener=mockReplySubscriptions.find(item=>item.event==='postgres_changes'&&item.filter.filter)!;
    await act(async()=>listener.callback({eventType:'INSERT',new:{broadcast_id:message.id,id:'latest'}}));await flush();
    expect(visibleText()).toContain('A fresh reply');expect(visibleText()).toContain('older');
    expect(input().props.value).toBe('Keep my words');
  });

  it('an older reply page failure keeps visible replies and the draft for retry',async()=>{
    mockRead.mockResolvedValue(historyPage('newest',true));
    await mount();await showReplies();await flush();type('Keep this draft');
    mockRead.mockRejectedValueOnce(Error('Lost connection'));
    await act(async()=>olderReplies()());await flush();
    expect(visibleText()).toContain('newest');expect(input().props.value).toBe('Keep this draft');
    if (kind === 'message') expect(tree.root.findAllByType(TouchableOpacity).filter(node => node.props.accessibilityLabel === 'Load earlier replies')).toHaveLength(0);
    mockRead.mockResolvedValueOnce(historyPage('older'));
    await act(async()=>recovery('Retry loading replies').props.onPress());await flush();
    expect(visibleText()).toContain('older');expect(visibleText()).toContain('newest');
    expect(input().props.value).toBe('Keep this draft');
  });

  it('an older reply result cannot cross an account visit',async()=>{
    mockRead.mockResolvedValue(historyPage('newest',true));await mount();await showReplies();await flush();
    const pending=deferred<any>();mockRead.mockReturnValueOnce(pending.promise);
    await act(async()=>olderReplies()());await flush();
    scope=nextScope('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');await update();
    mockRead.mockResolvedValue(historyPage('current'));await showReplies();await flush();
    await act(async()=>pending.resolve(historyPage('PRIVATE_OLD_REPLY')));await flush();
    expect(visibleText()).toContain('current');expect(visibleText()).not.toContain('PRIVATE_OLD_REPLY');
  });

  it('receives another member’s reply while the panel stays open, without changing the draft', async () => {
    await mount(); await showReplies(); type('My unfinished reply');
    mockRead.mockResolvedValue([{id:'remote',body:'See you there',sender_id:'other',created_at:'2026-09-21T12:00:00Z'}]);
    const listener=mockReplySubscriptions.find(item=>item.event==='postgres_changes' && item.filter.filter);
    expect(listener).toBeDefined();
    await act(async()=>listener!.callback({eventType:'INSERT',new:{broadcast_id:message.id,id:'remote'}}));await flush();
    expect(visibleText()).toContain('See you there');expect(input().props.value).toBe('My unfinished reply');
    scope=nextScope();await update();const before=mockRead.mock.calls.length;
    await act(async()=>listener!.callback({eventType:'INSERT',new:{broadcast_id:message.id,id:'late'}}));await flush();
    expect(mockRead.mock.calls.length).toBe(before);
  });

  it('preserves a newer reply draft after the earlier send succeeds', async () => {
    const pending = deferred(); mockReply.mockReturnValue(pending.promise);
    await mount(); await showReplies(); type('Submitted reply'); act(() => { void sendButton().props.onPress(); }); type('New unsent reply');
    await act(async () => pending.resolve()); await flush();
    expect(input().props.value).toBe('New unsent reply');
  });

  it('sends the selected duplicate-name identity with the original reply', async () => {
    const first = {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',first_name:'Alex',avatar_url:null};
    const selected = {id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',first_name:'Alex',avatar_url:null};
    (getBroadcastReplyMembers as jest.Mock).mockResolvedValue([first, selected]);
    await mount(); await showReplies(); type('@Al'); await flush();
    const picker = tree.root.findByType(ChatMentionPicker);
    expect(picker.props.members).toEqual([first, selected]);
    act(() => picker.props.onSelect(selected));
    expect(input().props.value).toBe('@Alex ');
    act(() => sendButton().props.onPress()); await flush();
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(mockReply.mock.calls[0][1]).toBe('@Alex');
    expect(JSON.stringify(mockReply.mock.calls[0][4])).toContain(selected.id);
    expect(JSON.stringify(mockReply.mock.calls[0][4])).not.toContain(first.id);
  });

  it('checks a lost response without resending or clearing the newer draft', async () => {
    mockReply.mockRejectedValueOnce(new Error('Lost response'));
    await mount(); await showReplies(); type('Original reply');
    act(() => sendButton().props.onPress()); await flush(); type('Newer draft');
    (checkTopicComposerAttempt as jest.Mock).mockResolvedValueOnce(true);
    act(() => recovery('Check original reply').props.onPress()); await flush();
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect((checkTopicComposerAttempt as jest.Mock).mock.calls[0][1].id).toBe(mockReply.mock.calls[0][3]);
    expect(input().props.value).toBe('Newer draft');
    expect(recovery('Check original reply')).toBeUndefined();
  });

  it('ends a stalled reply send with recovery and ignores its late completion', async () => {
    jest.useFakeTimers(); const pending=deferred(); mockReply.mockReturnValueOnce(pending.promise);
    try {
      await mount(); await showReplies(); type('Keep this reply');
      await act(async () => { sendButton().props.onPress(); await jest.advanceTimersByTimeAsync(1); });
      expect(mockReply).toHaveBeenCalledTimes(1);
      await act(async () => { await jest.advanceTimersByTimeAsync(12001); });
      expect(recovery('Check original reply')).toBeDefined();
      expect(input().props.value).toBe('Keep this reply');
      await act(async () => pending.resolve());
      expect(input().props.value).toBe('Keep this reply');
      expect(mockSuccess).not.toHaveBeenCalled();
    } finally {jest.useRealTimers();}
  });

  it('starts only one send from a retained double-tap callback', async () => {
    const pending = deferred(); mockReply.mockReturnValue(pending.promise);
    await mount(); await showReplies(); type('One reply'); const send = sendButton().props.onPress;
    act(() => { send(); send(); }); await flush();
    expect(mockReply).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
  });

  it('resets the new visit and keeps its draft and busy state when an old send finishes', async () => {
    const old = deferred(), fresh = deferred(); mockReply.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await mount(); await showReplies(); type('Old reply'); act(() => { void sendButton().props.onPress(); }); await flush();
    scope = nextScope('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); await update(); expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
    await showReplies(); type('New reply'); act(() => { void sendButton().props.onPress(); }); await flush();
    await act(async () => old.resolve()); await flush();
    expect(input().props.value).toBe('New reply'); expect(sendButton().props.disabled).toBe(true);
    expect(mockSuccess).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
    await act(async () => fresh.resolve()); await flush();
    expect(input().props.value).toBe(''); expect(mockSuccess).toHaveBeenCalledTimes(1);
  });

  it('retires queued input, send, reaction and picker callbacks before an account change rerenders', async () => {
    await mount(); await showReplies(); type('Old text');
    const oldInput = input().props.onChangeText, oldSend = sendButton().props.onPress;
    const oldReactions = tree.root.findByType(ReactionChips).props;
    epoch++;
    act(() => { oldInput('Queued text'); oldSend(); oldReactions.onReact('🔥'); oldReactions.onAddReaction(); });
    await flush();
    expect(mockReply).not.toHaveBeenCalled(); expect(mockReact).not.toHaveBeenCalled(); expect(mockAddReaction).not.toHaveBeenCalled();
    expect(tree.root.findAllByType(ReactionEmojiPicker)).toHaveLength(0);
  });

  it('keeps the original uncertain attempt across account A to B to A without losing newer text', async () => {
    const pending = deferred(); mockReply.mockReturnValueOnce(pending.promise);
    await mount(); await showReplies(); type('Old'); act(() => { void sendButton().props.onPress(); }); await flush();
    scope = nextScope('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); await update(); scope = nextScope(); await update();
    if (tree.root.findAllByType(TextInput).length === 0) await showReplies(); type('New');
    await act(async () => pending.reject(new Error('Old network failure'))); await flush();
    expect(input().props.value).toBe('New'); expect(mockError).not.toHaveBeenCalled();
    expect(sendButton().props.disabled).toBe(true);
    act(() => recovery('Retry original reply').props.onPress()); await flush();
    expect(mockReply).toHaveBeenCalledTimes(2);
    expect(mockReply.mock.calls[1][1]).toBe('Old');
    expect(mockReply.mock.calls[1][3]).toBe(mockReply.mock.calls[0][3]);
    expect(input().props.value).toBe('New');
    act(() => sendButton().props.onPress()); await flush();
    expect(mockReply.mock.calls[2][1]).toBe('New');
  });

  it('serializes reactions and stops late refresh after its scope is revoked', async () => {
    const pending = deferred(); mockReact.mockReturnValueOnce(pending.promise);
    message.reactions = [{ emoji: '❤️', mine: true, count: 1 }];
    await mount(); const react = tree.root.findByType(ReactionChips).props.onReact;
    act(() => { react('🔥'); react('👍'); }); expect(mockReact).toHaveBeenCalledTimes(1);
    epoch++; await act(async () => pending.resolve()); await flush();
    expect(mockReact).toHaveBeenCalledTimes(1); expect(invalidate).not.toHaveBeenCalled(); expect(mockError).not.toHaveBeenCalled();
  });

  it('isolates reply caches between viewers using a real QueryClient', async () => {
    mockRead.mockResolvedValueOnce([{ id: 'alice-private-reply', sender_name: 'Alice', body: 'Alice-only cached reply' }]);
    await mount(); await showReplies();
    for (let attempt = 0; attempt < 25 && !visibleText().includes('Alice-only cached reply'); attempt++) await flush();
    expect(visibleText()).toContain('Alice-only cached reply');
    const pending = deferred<any[]>(); mockRead.mockReturnValue(pending.promise);
    scope = nextScope('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); await update();
    if (tree.root.findAllByType(TextInput).length === 0) await showReplies(); await flush();
    expect(visibleText()).not.toContain('Alice-only cached reply');
    await act(async () => pending.resolve([{ id: 'bob-reply', sender_name: 'Bob', body: 'Bob fresh reply' }])); await flush();
    expect(visibleText()).toContain('Bob fresh reply');
  });

  it('never accepts a retired reply read into a later visit for the same account', async () => {
    const old = deferred<any[]>(), fresh = deferred<any[]>(); mockRead.mockReturnValueOnce(old.promise).mockReturnValue(fresh.promise);
    await mount(); await showReplies(); await flush();
    scope = nextScope('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); await update(); scope = nextScope(); await update();
    if (tree.root.findAllByType(TextInput).length === 0) await showReplies(); await flush();
    await act(async () => old.resolve([{ id: 'old-result', sender_name: 'Alice', body: 'Retired visit reply' }])); await flush();
    expect(visibleText()).not.toContain('Retired visit reply');
    await act(async () => fresh.resolve([{ id: 'new-result', sender_name: 'Alice', body: 'Current visit reply' }])); await flush();
    expect(visibleText()).toContain('Current visit reply');
  });

  it('preserves an unsuccessful reply and allows retry with its original text', async () => {
    mockReply.mockRejectedValueOnce(new Error('Offline'));
    await mount(); await showReplies(); type('Keep this text'); act(() => { void sendButton().props.onPress(); }); await flush();
    expect(input().props.value).toBe('Keep this text'); expect(mockError).not.toHaveBeenCalled(); expect(visibleText()).toContain('Your reply is kept.');
    act(() => recovery('Retry original reply').props.onPress()); await flush(); expect(mockReply).toHaveBeenCalledTimes(2);
    expect(mockReply.mock.calls[1][3]).toBe(mockReply.mock.calls[0][3]);
    expect(mockReply.mock.calls.map(call => call.slice(0, 2))).toEqual([['11111111-1111-4111-8111-111111111111', 'Keep this text'], ['11111111-1111-4111-8111-111111111111', 'Keep this text']]);
  });

  it('retires local controls when a different message reuses the component without a scope', async () => {
    scope = undefined; await mount(); await showReplies(); type('First message draft'); const oldSend = sendButton().props.onPress;
    message = { ...message, id: '22222222-2222-4222-8222-222222222222' }; await update();
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
    act(() => { void oldSend(); }); await flush(); expect(mockReply).not.toHaveBeenCalled();
    await showReplies(); type('Second message reply'); act(() => { void sendButton().props.onPress(); }); await flush();
    expect(mockReply.mock.calls[0].slice(0, 2)).toEqual(['22222222-2222-4222-8222-222222222222', 'Second message reply']);
  });

  it('passes the initiating scope through reads and replies and retires it on unmount', async () => {
    await mount(); await showReplies(); await flush(); type('A scoped reply'); act(() => { void sendButton().props.onPress(); }); await flush();
    const readScope = mockRead.mock.calls[0][1], replyScope = mockReply.mock.calls[0][2];
    expect(readScope.userId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); expect(replyScope.userId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(readScope.isCurrent()).toBe(false); // completed reads cannot publish again
    expect(replyScope.isCurrent()).toBe(false); // completed writes also retire their attempt
    await act(async () => tree.unmount());
    expect(readScope.isCurrent()).toBe(false); expect(replyScope.isCurrent()).toBe(false);
  });

  it('does not reopen a reply thread the user collapsed during a send', async () => {
    const pending = deferred(); mockReply.mockReturnValue(pending.promise);
    await mount(); await showReplies(); type('Reply'); act(() => { void sendButton().props.onPress(); }); await flush(); await showReplies();
    await act(async () => pending.resolve()); await flush();
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('shows a failed reply read with an explicit retry that recovers the original thread', async () => {
    mockRead.mockRejectedValueOnce(new Error('Offline'));
    await mount(); await showReplies(); await flush();
    const retryControl = () => tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Retry loading replies');
    for (let attempt = 0; attempt < 25 && !retryControl(); attempt++) await flush();
    const retry = retryControl();
    expect(retry).toBeDefined();
    mockRead.mockResolvedValueOnce([{ id: 'reply-id', sender_name: 'Amelia', body: 'Recovered reply' }]);
    act(() => { retry!.props.onPress(); }); await flush();
    for (let attempt = 0; attempt < 25 && !visibleText().includes('Recovered reply'); attempt++) await flush();
    expect(visibleText()).toContain('Recovered reply');
    expect(mockRead.mock.calls.map(call => call[0])).toEqual(['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111']);
  });

  it('keeps the original reaction policy and table keys', async () => {
    message.reactions = [{ emoji: 'heart', mine: true, count: 2 }, { emoji: '🔥', mine: false, count: 1 }];
    await mount();
    act(() => { tree.root.findByType(ReactionChips).props.onReact('🔥'); }); await flush();
    expect(mockReact.mock.calls.map(call => call.slice(0, 3))).toEqual(kind === 'message'
      ? [['11111111-1111-4111-8111-111111111111', 'heart', false], ['11111111-1111-4111-8111-111111111111', '🔥', true]]
      : [['11111111-1111-4111-8111-111111111111', '🔥', true]]);
    expect(mockReact.mock.calls.every(call => call[3].userId === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' && call[3].isCurrent())).toBe(true);
  });

  it('suppresses send side effects after the component has unmounted', async () => {
    const pending = deferred(); mockReply.mockReturnValue(pending.promise);
    await mount(); await showReplies(); type('Leaving now'); act(() => { void sendButton().props.onPress(); }); await flush();
    await act(async () => tree.unmount()); await act(async () => pending.resolve()); await flush();
    expect(mockSuccess).not.toHaveBeenCalled(); expect(mockError).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
  });

  if (kind === 'message') {
    it('delegates quick reactions to the page coordinator without a second transport path', async () => {
      const pending = deferred(); delegatedReact = jest.fn().mockReturnValue(pending.promise);
      await mount(); const react = tree.root.findByType(ReactionChips).props.onReact;
      act(() => { react('🔥'); react('👍'); });
      expect(delegatedReact).toHaveBeenCalledTimes(1); expect(delegatedReact).toHaveBeenCalledWith('🔥');
      expect(mockReact).not.toHaveBeenCalled();
      epoch++; await act(async () => pending.resolve()); await flush();
      act(() => react('❤️')); await flush();
      expect(delegatedReact).toHaveBeenCalledTimes(1); expect(invalidate).not.toHaveBeenCalled();
    });
  } else {
    it('keeps the original intro payload and composed text', async () => {
      const payload = { first_name: 'Amelia', answers: [{ answer: 'Sunset volleyball' }] };
      message = { ...message, kind: 'intro', payload };
      await mount();
      expect(mockComposeIntro).toHaveBeenCalledWith(payload);
      expect(tree.root.findAllByType(LinkifiedText).map(node => node.props.text)).toEqual(['Amelia joined us', 'A preserved answer']);
    });

    it('retires picker select and close callbacks without dismissing the new visit picker', async () => {
      await mount(); act(() => tree.root.findByType(ReactionChips).props.onAddReaction());
      const oldPicker = tree.root.findByType(ReactionEmojiPicker).props;
      scope = nextScope(); await update(); act(() => tree.root.findByType(ReactionChips).props.onAddReaction());
      act(() => { oldPicker.onClose(); oldPicker.onSelect('🔥'); }); await flush();
      expect(tree.root.findAllByType(ReactionEmojiPicker)).toHaveLength(1); expect(mockReact).not.toHaveBeenCalled();
      act(() => tree.root.findByType(ReactionEmojiPicker).props.onSelect('🔥')); await flush();
      expect(mockReact).toHaveBeenCalledTimes(1);
    });
  }
});
