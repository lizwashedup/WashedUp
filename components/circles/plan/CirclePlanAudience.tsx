import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { composerStyles, type ComposerAppearance } from './circlePlanStyles';

export interface ComposerMember {
  user_id: string;
  handle?: string | null;
  first_name_display: string | null;
  profile_photo_url: string | null;
}

/** One row in the "pick people" multiselect: avatar, name, a terracotta check. */
export function PickMemberRow({
  member,
  selected,
  onToggle,
  appearance,
}: {
  appearance?: ComposerAppearance;
  member: ComposerMember;
  selected: boolean;
  onToggle: () => void;
}) {
  const name = member.first_name_display?.trim() || member.handle?.trim() || 'Someone';
  const handleValue = member.handle?.trim().replace(/^@+/, '');
  const handle = handleValue ? `@${handleValue}` : null;
  const styles = useMemo(() => composerStyles(appearance), [appearance]);
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onToggle}
      style={styles.memberRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={handle ? `${name}, ${handle}` : name}
    >
      {appearance ? (
        <MemberPhoto key={`${member.user_id}:${member.profile_photo_url ?? ''}`}
          uri={member.profile_photo_url} name={name} appearance={appearance} />
      ) : member.profile_photo_url ? (
        <Image source={{ uri: member.profile_photo_url }} style={styles.memberAvatar} />
      ) : (
        <View style={[styles.memberAvatar, styles.memberAvatarPlaceholder]}>
          <Text style={styles.memberInitial}>{name[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <View style={styles.memberIdentity}>
        <Text style={styles.memberName} numberOfLines={appearance ? undefined : 1}>{name}</Text>
        {handle ? <Text style={styles.memberHandle} numberOfLines={1}>{handle}</Text> : null}
      </View>
      <View style={[styles.memberCheck, selected && styles.memberCheckOn]}>
        {selected ? <Check size={12} color={appearance ? AfterglowColors.white : Colors.white} strokeWidth={3} /> : null}
      </View>
    </TouchableOpacity>
  );
}

function MemberPhoto({ uri, name, appearance }: { uri: string | null; name: string; appearance: ComposerAppearance }) {
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const styles = useMemo(() => composerStyles(appearance), [appearance]);
  return uri && !failed ? <Image source={{ uri }} style={styles.memberAvatar} contentFit="cover"
    onError={() => { if (mounted.current) setFailed(true); }} /> :
    <View style={[styles.memberAvatar, styles.memberAvatarPlaceholder]}>
      <Text style={styles.memberInitial}>{name[0]?.toUpperCase() ?? '?'}</Text>
    </View>;
}

export function AudienceCard({ appearance, selected, label, subtitle, onSelect, children }: {
  appearance?: ComposerAppearance; selected: boolean; label: string; subtitle: string;
  onSelect: () => void; children?: React.ReactNode;
}) {
  const styles = useMemo(() => composerStyles(appearance), [appearance]);
  const heading = <View style={styles.audTop}>
    <View style={styles.audTextWrap}>
      <Text style={styles.audName}>{label}</Text>
      <Text style={styles.audSub}>{subtitle}</Text>
    </View>
    <View style={[styles.radio, selected && styles.radioOn]}>
      {selected ? <Animated.View entering={ZoomIn.springify().mass(0.5).damping(24).stiffness(500)} style={styles.radioDot} /> : null}
    </View>
  </View>;
  // Keep the legacy surface. In the staged form, child controls are siblings
  // of the audience selector, so a checkbox or stepper is not inside a button.
  return appearance ? <View style={[styles.audCard, selected && styles.audCardOn]}>
    <TouchableOpacity activeOpacity={0.85} onPress={onSelect} accessibilityRole="radio"
      accessibilityState={{ checked: selected }} accessibilityLabel={label}
      accessibilityHint={subtitle} style={{ minHeight: 44, justifyContent: 'center' }}>
      {heading}
    </TouchableOpacity>
    {children}
  </View> : <TouchableOpacity activeOpacity={0.85} onPress={onSelect}
    style={[styles.audCard, selected && styles.audCardOn]}>{heading}{children}</TouchableOpacity>;
}

