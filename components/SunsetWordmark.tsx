import React, {useId} from 'react';
import {View, type StyleProp, type ViewStyle} from 'react-native';
import Svg, {Defs, Mask, Image as SvgImage, Rect, LinearGradient, Stop} from 'react-native-svg';
import Colors, {SunsetActionColors} from '../constants/Colors';
/** Retains the exact existing wordmark silhouette; only its rendered ink changes. */
export function SunsetWordmark({style}:{style?:StyleProp<ViewStyle>}) {
 const id=useId().replace(/:/g,'');
 return <View accessibilityRole="image" accessibilityLabel="WashedUp" style={style}>
  <Svg width="100%" height="100%" viewBox="0 0 2635 604" preserveAspectRatio="xMidYMid meet" accessible={false}>
   <Defs>
    <Mask id={`mask${id}`} maskType="alpha" x="0" y="0" width="2635" height="604" maskUnits="userSpaceOnUse">
     <SvgImage href={require('../assets/images/washedup-logo.png')} width="2635" height="604"/>
    </Mask>
    <LinearGradient id={`ink${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
     <Stop offset="0%" stopColor={Colors.terracotta}/><Stop offset="100%" stopColor={SunsetActionColors.lower}/>
    </LinearGradient>
   </Defs>
   <Rect width="2635" height="604" fill={`url(#ink${id})`} mask={`url(#mask${id})`}/>
  </Svg>
 </View>;
}
