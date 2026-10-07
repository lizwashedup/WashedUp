import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { AfterglowColors } from '../../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import type { YoursGridPerson } from '../../../lib/yours/types';

export default function CreationPersonPhoto({ person, fonts }: { person: YoursGridPerson; fonts: AfterglowFontFamilies }) {
  return <Photo key={`${person.user_id}:${person.profile_photo_url ?? ''}`} person={person} fonts={fonts}/>;
}
function Photo({ person, fonts }: { person: YoursGridPerson; fonts: AfterglowFontFamilies }) {
  const [failed, setFailed] = useState(false);
  const name = person.first_name_display?.trim() || person.handle?.trim() || 'Someone';
  const size = { width: 54, height: 54, borderRadius: 27 };
  return person.profile_photo_url && !failed ? <Image source={{ uri: person.profile_photo_url }} style={size} contentFit="cover" accessibilityIgnoresInvertColors onError={() => setFailed(true)}/> :
    <View style={[size, { backgroundColor: AfterglowColors.avatar, alignItems: 'center', justifyContent: 'center' }]}><Text style={{ ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.muted }}>{Array.from(name)[0]?.toUpperCase()}</Text></View>;
}
