import { useFonts } from 'expo-font';
import { AfterglowFallbackFonts, AfterglowFonts, CreatorFonts } from '../constants/Typography';
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { CormorantGaramond_700Bold } from '@expo-google-fonts/cormorant-garamond';

const assets = {
  [AfterglowFonts.regular]: DMSans_400Regular,
  [AfterglowFonts.medium]: DMSans_500Medium,
  [AfterglowFonts.semibold]: DMSans_600SemiBold,
  [AfterglowFonts.display]: CormorantGaramond_700Bold,
};

const creatorAssets = {
  [CreatorFonts.regular]: require('../assets/fonts/creator/InterCreator400.ttf'),
  [CreatorFonts.medium]: require('../assets/fonts/creator/InterCreator500.ttf'),
  [CreatorFonts.display]: require('../assets/fonts/creator/NewsreaderCreator500.ttf'),
};

/** Font loading never gates navigation, messages or membership. */
export function useAfterglowFonts(enabled = true, typography: 'existing' | 'creator' = 'existing') {
  const [loaded, error] = useFonts(enabled ? typography === 'creator' ? creatorAssets : assets : {});
  return { fonts: loaded ? typography === 'creator' ? CreatorFonts : AfterglowFonts : AfterglowFallbackFonts, loaded, error };
}
