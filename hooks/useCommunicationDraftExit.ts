import { useRef } from 'react';
import { Alert } from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import type { CreatorPageScope } from '../lib/creatorPageReview';

/** Native back/gesture must not silently drop a draft whose local write failed. */
export function useCommunicationDraftExit(scope: CreatorPageScope, draft: {loaded: boolean; saving: boolean; readError: boolean; error: string; save(): Promise<boolean>}) {
  const navigation = useNavigation();
  const asking = useRef(false);
  const unsaved = draft.loaded && (draft.saving || !!draft.error && !draft.readError);
  usePreventRemove(unsaved && scope.isCurrent(), ({data}) => {
    if (asking.current || !scope.isCurrent()) return;
    asking.current = true;
    Alert.alert('Keep your draft?', 'Your latest changes haven’t been saved on this device.', [
      {text:'Keep editing', style:'cancel', onPress:()=>{asking.current=false;}},
      {text:'Leave without saving', style:'destructive', onPress:()=>{asking.current=false;if(scope.isCurrent())navigation.dispatch(data.action);}},
      {text:'Save and leave', onPress:()=>{void (async()=>{
        const saved=await draft.save();asking.current=false;
        if(saved && scope.isCurrent())navigation.dispatch(data.action);
      })();}},
    ]);
  });
}
