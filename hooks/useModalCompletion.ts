import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/** Complete navigation only after the initiating iOS modal has dismissed. */
export function useModalCompletion(owner: object, onComplete: () => void, isCurrent: () => boolean) {
  const mounted = useRef(false);
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const closedOwner = useRef<object | null>(null);
  const pending = useRef<{ owner: object; complete: () => void; isCurrent: () => boolean } | null>(null);
  const [closingOwner, setClosingOwner] = useState<object | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current = null; };
  }, []);
  const onDismiss = useCallback(() => {
    const call = pending.current;
    if (!call || call.owner !== owner) return;
    pending.current = null;
    if (mounted.current && currentOwner.current === call.owner && call.isCurrent()) call.complete();
  }, [owner]);
  const requestClose = (presented = true) => {
    if (!mounted.current || currentOwner.current !== owner || closedOwner.current === owner || !isCurrent()) return;
    closedOwner.current = owner;
    pending.current = { owner, complete: onComplete, isCurrent };
    setClosingOwner(owner);
    // Android has no Modal.onDismiss callback. A never-presented empty optional
    // step also has no native dismissal to wait for on either platform.
    if (Platform.OS !== 'ios' || !presented) onDismiss();
  };
  return { closing: closingOwner === owner, requestClose, onDismiss };
}
