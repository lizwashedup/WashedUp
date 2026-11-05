import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { ChevronLeft, MoreHorizontal } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import type { AfterglowFontFamilies } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import type { AnchorRect } from '../../menu/MenuCard';
import type { PersonProfileUpcoming, PersonProfilePast, PersonProfileMutualFace } from '../../../lib/yours/types';
import { initialOf } from '../../../lib/yours/personDisplay';
import { baseStyles, profileAppearance } from './personProfileStyles';

export type Appearance = { fonts: AfterglowFontFamilies };
export const AppearanceContext = createContext<Appearance | undefined>(undefined);
export function useProfileStyles() {
  const appearance = useContext(AppearanceContext);
  return { appearance, styles: useMemo(() => appearance ? { ...baseStyles, ...profileAppearance(appearance.fonts) } : baseStyles, [appearance]) };
}

/** "Sat, Jun 14", pinned to the LA clock plans live on (no dashes). */
function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

/** "March 2025", LA clock, for the joined-since trust signal. */
export function fmtMonthYear(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'long',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

/** Up to three overlapping mutual faces + "you both know {name} and N others". */
export function MutualFaces({
  faces,
  total,
}: {
  faces: PersonProfileMutualFace[];
  total: number;
}) {
  const { styles, appearance } = useProfileStyles();
  if (total <= 0) return null;
  const lead = faces[0]?.first_name_display ?? 'someone';
  return (
    <View style={styles.mutuals}>
      {faces.length > 0 && (
        <View style={styles.mutualStack}>
          {faces.map((f, i) => (
            <View key={f.user_id} style={[styles.mutualFace, i > 0 && styles.mutualFaceOverlap]}>
              <ProfilePhoto key={JSON.stringify([f.user_id, f.profile_photo_url])} name={f.first_name_display} uri={f.profile_photo_url} small />
            </View>
          ))}
        </View>
      )}
      <Text style={styles.mutualText} numberOfLines={appearance ? undefined : 2}>
        {COPY.ppMutuals(lead, total)}
      </Text>
    </View>
  );
}

/** Back chevron always; overflow only when there is a real profile to act on. */
export function TopBar({ onMore, onBack, busy = false }: { onMore?: (anchor: AnchorRect) => void; onBack: () => void; busy?: boolean }) {
  const { styles, appearance } = useProfileStyles();
  const color = appearance ? AfterglowColors.ink : Colors.asphalt;
  const moreRef = useRef<View>(null);
  const press = () => {
    if (!onMore) return;
    moreRef.current?.measureInWindow((x, y, width, height) =>
      onMore({ x, y, width, height }),
    );
  };
  return (
    <View style={styles.topBar}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <ChevronLeft size={24} color={color} />
      </Pressable>
      {onMore ? (
        <Pressable
          ref={moreRef}
          onPress={press}
          disabled={busy}
          accessibilityState={{ disabled: busy }}
          hitSlop={12}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <MoreHorizontal size={22} color={color} />
        </Pressable>
      ) : (
        <View style={styles.iconBtn} />
      )}
    </View>
  );
}

function ProfilePhoto({ name, uri, small = false }: { name: string | null; uri: string | null; small?: boolean }) {
  const { styles } = useProfileStyles();
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return uri && !failed ? <Image source={{ uri }} style={small ? styles.mutualImg : styles.avatarImg} contentFit="cover"
    recyclingKey={uri} onError={() => { if (mounted.current) setFailed(true); }} /> :
    <Text style={small ? styles.mutualInitial : styles.avatarInitial}>{initialOf(name)}</Text>;
}
export function Avatar({ name, photoUrl }: { name: string | null; photoUrl: string | null }) {
  const { styles } = useProfileStyles();
  return <View style={styles.avatar}><ProfilePhoto key={JSON.stringify([name, photoUrl])} name={name} uri={photoUrl}/></View>;
}

export function SectionLabel({ children }: { children: string }) {
  const { styles } = useProfileStyles();
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function UpcomingRow({ row, onOpen }: { row: PersonProfileUpcoming; onOpen: (id: string) => void }) {
  const { styles, appearance } = useProfileStyles();
  const [pressed, setPressed] = useState(false);
  const date = fmtDate(row.start_time);
  return (
    <Pressable
      onPress={() => onOpen(row.event_id)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.planRow, pressed && styles.planRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}. ${date}.`}
    >
      <View style={styles.dateDot} />
      <View style={styles.planText}>
        <Text style={styles.planTitle} numberOfLines={appearance ? undefined : 1}>
          {row.title}
        </Text>
        <Text style={styles.planMeta} numberOfLines={appearance ? undefined : 1}>
          {row.neighborhood ? `${date} · ${row.neighborhood}` : date}
        </Text>
      </View>
    </Pressable>
  );
}

export function PastRow({ row, onOpen }: { row: PersonProfilePast; onOpen: (id: string) => void }) {
  const { styles, appearance } = useProfileStyles();
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={() => onOpen(row.event_id)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.planRow, pressed && styles.planRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}. ${fmtDate(row.date)}.`}
    >
      <Text style={styles.pastDate}>{fmtDate(row.date)}</Text>
      <Text style={styles.pastTitle} numberOfLines={appearance ? undefined : 1}>
        {row.title}
      </Text>
    </Pressable>
  );
}

