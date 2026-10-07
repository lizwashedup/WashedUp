import { Platform, type AccessibilityActionEvent } from 'react-native';

export function messageActionAccess(open: () => void) {
  return {
    accessibilityActions: [{ name: 'messageActions', label: 'Message actions' }],
    onAccessibilityAction: (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'messageActions') open();
    },
  };
}

// Attach web events to the surrounding View: RN Web owns a pressable's
// own context-menu/key handlers for its long-press responder.
export function messageActionWeb(open: () => void) {
  return Platform.OS === 'web' ? {
      onContextMenu: (event: { preventDefault: () => void }) => { event.preventDefault(); open(); },
      onKeyDownCapture: (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); open(); }
      },
    } : {};
}
