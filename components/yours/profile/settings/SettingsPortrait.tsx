import React, { useLayoutEffect, useRef, useState } from 'react';
import { View, Text, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { Image, type ImageStyle } from 'expo-image';
import { initialOf } from '../../../../lib/yours/personDisplay';
export default function SettingsPortrait({ uri, name, style, fallbackStyle, textStyle }: { uri: string | null; name: string | null; style: StyleProp<ImageStyle & ViewStyle>; fallbackStyle: StyleProp<ViewStyle>; textStyle: StyleProp<TextStyle> }) {
  const [failed, setFailed] = useState(false), live = useRef(false);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return uri && !failed ? <Image source={{ uri }} style={style} recyclingKey={uri} contentFit="cover" onError={() => { if (live.current) setFailed(true); }}/> : <View style={[style, fallbackStyle]}><Text style={textStyle}>{initialOf(name)}</Text></View>;
}
