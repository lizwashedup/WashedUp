import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CreatorSurfaceColors as G } from '../../constants/Colors';
export function GoldSurfaceFill({radius=16}:{radius?:number}) {
 return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill,{borderRadius:radius,overflow:'hidden'}]}>
  <LinearGradient colors={[G.selectionTop,G.selectionBottom]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill}/>
 </View>;
}
