import React, { useCallback } from 'react';
import type { TextProps } from 'react-native';
import { ScaledText } from '../ScaledText';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { loadSavedEventOrganizer } from '../../lib/creatorEventIdentity';

export function SavedEventOrganizer({ eventId, style }: { eventId: string; style: TextProps['style'] }) {
  const { scope } = useCreatorPageScope('saved-event-organizer:' + eventId);
  const read = useCallback((visit: CreatorPageScope) => loadSavedEventOrganizer(eventId, visit), [eventId]);
  const name = useCreatorPageRead(scope, read);
  let label = 'Organizer unavailable';
  if (!name.error && scope?.isCurrent()) {
    label = name.data ?? (name.loading ? 'Loading organizer…' : label);
  }
  return <ScaledText style={style}>{label}</ScaledText>;
}
