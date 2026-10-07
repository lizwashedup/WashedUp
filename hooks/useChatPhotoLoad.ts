import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { validPhotoSize, type PhotoSize } from '../lib/chatPhotoLayout';

/** The owning photo component is keyed by URI. Each retry has separate ownership. */
export function useChatPhotoLoad(initialSize: PhotoSize | null = null, onSize?: (size: PhotoSize) => void) {
  const [size, setSize] = useState(initialSize);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const owner = useMemo(() => ({}), [attempt]);
  const active = useRef<object | null>(null);
  useLayoutEffect(() => {
    active.current = owner;
    return () => { if (active.current === owner) active.current = null; };
  }, [owner]);
  const onLoad = useCallback((event: { source: PhotoSize }) => {
    if (active.current !== owner) return;
    if (validPhotoSize(event.source)) {
      const natural = { width: event.source.width, height: event.source.height };
      onSize?.(natural);
      setSize(previous => active.current === owner ? natural : previous);
    }
    setStatus(previous => active.current === owner ? 'loaded' : previous);
  }, [owner, onSize]);
  const onError = useCallback(() => {
    if (active.current === owner) setStatus(previous => active.current === owner ? 'error' : previous);
  }, [owner]);
  const retry = useCallback(() => {
    if (active.current !== owner) return;
    active.current = null;
    setStatus('loading');
    setAttempt(value => value + 1);
  }, [owner]);
  return { size, status, attempt, onLoad, onError, retry };
}
