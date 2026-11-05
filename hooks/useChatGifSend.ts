import { useCallback, useLayoutEffect, useRef } from 'react';
import * as Crypto from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import type { ChatOperationScope } from '../lib/chatMessageModel';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import type { useChat } from './useChat';

type Options = {
  entry: object;
  writableVisit: object;
  scope: ChatOperationScope;
  sendMessage: ReturnType<typeof useChat>['sendMessage'];
  captureScrollIntent: () => () => boolean;
  onStart: () => void;
  onConfirmed: () => void;
  onUnconfirmed: (retry: () => void) => void;
};

/** One in-flight GIF, with the same delivery ID retained for explicit retry. */
export function useChatGifSend({ entry, writableVisit, scope, sendMessage, captureScrollIntent, onStart, onConfirmed, onUnconfirmed }: Options) {
  const pendingAttempt = useRef<object | null>(null);
  const pendingIds = useRef(new Map<string, string>());
  useFocusEffect(useCallback(() => { pendingAttempt.current = null; }, [writableVisit]));
  useLayoutEffect(() => {
    pendingAttempt.current = null;
    pendingIds.current.clear();
  }, [entry]);

  return useCallback(async function sendGif(url: string) {
    if (!scope.isCurrent() || pendingAttempt.current) return;
    const attempt = {}; pendingAttempt.current = attempt;
    const isCurrent = () => scope.isCurrent() && pendingAttempt.current === attempt;
    const sendScope = { ...scope, isCurrent };
    let sendId = pendingIds.current.get(url);
    if (!sendId) { sendId = Crypto.randomUUID(); pendingIds.current.set(url, sendId); }
    onStart();
    const scrollIntentIsCurrent = captureScrollIntent();
    try {
      const sent = await requestWithDeadline(sendMessage('', url, undefined, sendId, sendScope), 25_000);
      if (!isCurrent()) return;
      if (!sent) throw Error('GIF delivery is unconfirmed.');
      pendingIds.current.delete(url);
      if (scrollIntentIsCurrent()) onConfirmed();
    } catch {
      if (isCurrent()) onUnconfirmed(() => { if (scope.isCurrent()) void sendGif(url); });
    } finally {
      if (pendingAttempt.current === attempt) pendingAttempt.current = null;
    }
  }, [scope, sendMessage, captureScrollIntent, onStart, onConfirmed, onUnconfirmed]);
}
