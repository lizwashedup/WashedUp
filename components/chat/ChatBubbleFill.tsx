import React from 'react';
import {StyleSheet} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import Colors,{SunsetActionColors} from '../../constants/Colors';

/** Quiet sunset depth behind outgoing text; message content stays accessible. */
export function ChatBubbleFill(){
 return <LinearGradient pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
  colors={[Colors.terracotta,SunsetActionColors.lower]} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.fill}/>;
}
const styles=StyleSheet.create({fill:{...StyleSheet.absoluteFillObject,borderRadius:14,borderBottomRightRadius:5}});
