const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('chat and event-form UX contracts', () => {
  it('dismisses the event-form keyboard when scrolling begins', () => {
    const eventForm = source('app/creator/event-form.tsx');

    expect(eventForm).toContain("keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}");
    expect(eventForm).toContain('onScrollBeginDrag={Keyboard.dismiss}');
  });

  it('returns from a conversation to the Chats screen', () => {
    const thread = source('components/chat/ChatThread.tsx');

    expect(thread).toContain("router.replace('/(tabs)/chats' as never)");
  });

  it('starts a reply when a plain text message is tapped', () => {
    const thread = source('components/chat/ChatThread.tsx');

    expect(thread).toContain("const canTapToReply = message.message_type === 'user' && !message.image_url && !firstUrl;");
    expect(thread).toContain('onStartReply?.(message.id)');
    expect(thread).toContain('onStartReply={!isPast ? handleTriggerReply : undefined}');
    expect(thread).toContain('requestAnimationFrame(() => textInputRef.current?.focus())');
  });

  it('does not block first paint on secondary chat enrichment', () => {
    const chat = source('hooks/useChat.ts');
    const list = source('hooks/useChatList.ts');

    expect(chat).toContain('setLoading(false);');
    expect(chat).toContain("void (async () => {");
    expect(chat).toContain("logError(error, 'useChat.hydrateNewestPage')");
    expect(chat).not.toContain("logError(err, 'useChat.getUser')");
    expect(list).toContain('chatListMemoryCache');
    expect(list).toContain('const circlePreviewsPromise');
    expect(list).toContain('setChats(sortChatPreviews(firstPaint));');
    expect(list).not.toContain('supabase.auth.getUser');
  });

  it('does not duplicate the mount fetch on first focus', () => {
    const thread = source('components/chat/ChatThread.tsx');
    const listScreen = source('app/(tabs)/chats/index.tsx');

    expect(thread).toContain('if (!isFirstFocus && nowTs - lastChatFocusFetchRef.current > 15_000)');
    expect(listScreen).toContain('if (!isFirstFocus && (isDirty || nowTs - lastChatsFocusFetchRef.current > 30_000))');
  });
});
