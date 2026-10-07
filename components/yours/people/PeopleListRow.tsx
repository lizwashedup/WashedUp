import React, { useLayoutEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MoreHorizontal } from 'lucide-react-native';
import { AfterglowColors } from '../../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { initialOf, upcomingLabel } from '../../../lib/yours/personDisplay';
import type { YoursGridPerson } from '../../../lib/yours/types';
import type { AnchorRect } from '../../menu/MenuCard';
import { ScaledText } from '../../ScaledText';

export type PeopleAppearance = { fonts: AfterglowFontFamilies };
type PersonProps = {
  person: YoursGridPerson;
  appearance: PeopleAppearance;
  onPress: (person: YoursGridPerson) => void;
  onLongPress: (person: YoursGridPerson, rect: AnchorRect) => void;
};

/** These fields describe shared plan history and the person's next visible
 * plan. An upcoming plan alone does not establish that the viewer joined it. */
export function peopleContext(person: YoursGridPerson): string | null {
  if (person.upcoming_title && person.upcoming_start) return upcomingLabel(person);
  if (person.shared_count > 0) {
    return `${person.shared_count} shared ${person.shared_count === 1 ? 'plan' : 'plans'}`;
  }
  const handle = person.handle?.trim().replace(/^@+/, '');
  return handle ? `@${handle}` : null;
}

// Remounted by person + photo identity below, so a failed old request cannot
// hide a replacement image or another person's image in a reused row.
function PersonPhoto({ person, appearance }: Pick<PersonProps, 'person' | 'appearance'>) {
  const [failed, setFailed] = useState(false);
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  return person.profile_photo_url && !failed ? (
    <Image
      source={{ uri: person.profile_photo_url }}
      style={styles.photo}
      contentFit="cover"
      recyclingKey={`${person.user_id}:${person.profile_photo_url}`}
      onError={() => { if (active.current) setFailed(true); }}
      accessible={false}
    />
  ) : (
    <ScaledText style={[styles.initial, { fontFamily: appearance.fonts.semibold }]} accessible={false}>
      {initialOf(person.first_name_display)}
    </ScaledText>
  );
}

function usePersonActions({ person, onPress, onLongPress }: PersonProps) {
  const faceRef = useRef<View>(null);
  const lifetime = useRef<object | null>(null);
  const current = useRef({ person, onPress, onLongPress });
  current.current = { person, onPress, onLongPress };
  useLayoutEffect(() => {
    const scope = {};
    lifetime.current = scope;
    return () => { if (lifetime.current === scope) lifetime.current = null; };
  }, [person.user_id, onPress, onLongPress]);
  const open = () => {
    if (lifetime.current && current.current.person.user_id === person.user_id) {
      current.current.onPress(current.current.person);
    }
  };
  const options = () => {
    const scope = lifetime.current;
    if (!scope || current.current.person.user_id !== person.user_id) return;
    const handler = onLongPress;
    faceRef.current?.measureInWindow((x, y, width, height) => {
      if (lifetime.current !== scope || current.current.onLongPress !== handler ||
          current.current.person.user_id !== person.user_id) return;
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
      handler(current.current.person, { x, y, width, height });
    });
  };
  return { faceRef, open, options };
}

function PeopleListRow(props: PersonProps) {
  const { person, appearance } = props;
  const { faceRef, open, options } = usePersonActions(props);
  const name = person.first_name_display?.trim() || 'Someone';
  const context = peopleContext(person);
  return (
    <View style={styles.row}>
      {/* NativeWind's Pressable callback styling must not own row geometry.
          Plain Views retain the photo-left layout and reserve menu space. */}
      <View style={styles.mainSlot}>
        <Pressable
          style={({ pressed }) => pressed && styles.pressed}
          onPress={open}
          onLongPress={options}
          delayLongPress={300}
          accessibilityRole="button"
          accessibilityLabel={context ? `${name}, ${context}` : name}
          accessibilityHint="Opens your page with this person"
          testID={`people-row-${person.user_id}`}
        >
          <View style={styles.main}>
            <View ref={faceRef} collapsable={false} style={styles.face}>
              <PersonPhoto key={`${person.user_id}:${person.profile_photo_url}`} person={person} appearance={appearance} />
            </View>
            <View style={styles.copy}>
              <ScaledText style={[styles.name, { fontFamily: appearance.fonts.semibold }]}>{name}</ScaledText>
              {context && <ScaledText numberOfLines={1} style={[styles.context, { fontFamily: appearance.fonts.regular }]}>{context}</ScaledText>}
            </View>
          </View>
        </Pressable>
      </View>
      {/* A sibling of the person target, never a nested press target. */}
      <Pressable
        style={({ pressed }) => pressed && styles.pressed}
        onPress={options}
        accessibilityRole="button"
        accessibilityLabel={`Options for ${name}`}
        accessibilityHint="Opens available actions for this person"
        testID={`people-options-${person.user_id}`}
      >
        <View style={styles.options}>
          <MoreHorizontal size={21} color={AfterglowColors.muted} strokeWidth={1.8} />
        </View>
      </Pressable>
    </View>
  );
}

/** Keeps the existing recent membership/order without a second dense list. */
export const PeopleRecentPerson = React.memo(function PeopleRecentPerson(props: PersonProps) {
  const { person, appearance } = props;
  const { faceRef, open, options } = usePersonActions(props);
  const name = person.first_name_display?.trim() || 'Someone';
  return (
    <Pressable
      style={({ pressed }) => pressed && styles.pressed}
      onPress={open}
      onLongPress={options}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={name}
      testID={`people-recent-${person.user_id}`}
    >
      <View style={styles.recent}>
        <View ref={faceRef} collapsable={false} style={styles.face}>
          <PersonPhoto key={`${person.user_id}:${person.profile_photo_url}`} person={person} appearance={appearance} />
        </View>
        <ScaledText numberOfLines={1} style={[styles.recentName, { fontFamily: appearance.fonts.medium }]}>{name}</ScaledText>
      </View>
    </Pressable>
  );
});

export default React.memo(PeopleListRow);

const styles = StyleSheet.create({
  row: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', minHeight: 82, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine },
  mainSlot: { flex: 1, minWidth: 0 },
  main: { alignSelf: 'stretch', minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingRight: 6, minHeight: 82 },
  face: { width: 54, height: 54, borderRadius: 27, backgroundColor: AfterglowColors.avatar, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  photo: { width: 54, height: 54, opacity: 1 },
  initial: { ...AfterglowType.contextTitle, color: AfterglowColors.muted },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  name: { ...AfterglowType.title, color: AfterglowColors.ink },
  context: { ...AfterglowType.body, color: AfterglowColors.muted },
  options: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: 4 },
  pressed: { backgroundColor: AfterglowColors.unread },
  recent: { width: 66, alignItems: 'center', gap: 7, paddingVertical: 3 },
  recentName: { ...AfterglowType.caption, color: AfterglowColors.ink, maxWidth: 66 },
});
