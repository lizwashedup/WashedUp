import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { useObservedUser } from '../../hooks/useObservedUser';

/** Protect in-memory answers from Back and native swipe dismissal. Prefill is not an edit. */
export function useApplicationDraftExit(done: boolean, submitting: boolean) {
  const navigation = useNavigation();
  const viewer = useObservedUser();
  const [edited, setEdited] = useState(false);
  const live = useRef(false);
  const asking = useRef(false);
  const latest = useRef({ done, submitting });
  latest.current = { done, submitting };
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  usePreventRemove(!done && (edited || submitting) && viewer.viewerId !== null, ({ data }) => {
    if (asking.current || !live.current || !viewer.isCurrent()) return;
    asking.current = true;
    const reset = () => { asking.current = false; };
    if (latest.current.submitting) {
      Alert.alert('Sending application', 'Please wait while we check your submission.', [{ text: 'OK', onPress: reset }], { onDismiss: reset });
      return;
    }
    const isCurrent = viewer.isCurrent;
    Alert.alert('Leave this application?', 'Your changes haven’t been submitted. Leaving will discard them.', [
      { text: 'Keep editing', style: 'cancel', onPress: reset },
      { text: 'Discard changes', style: 'destructive', onPress: () => {
        reset();
        if (live.current && isCurrent() && !latest.current.submitting) navigation.dispatch(data.action);
      } },
    ], { cancelable: true, onDismiss: reset });
  });

  return function edit<T>(change: (value: T) => void) {
    return (value: T) => { setEdited(true); change(value); };
  };
}
