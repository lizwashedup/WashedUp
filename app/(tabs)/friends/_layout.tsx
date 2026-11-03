import { Stack } from 'expo-router';

export const unstable_settings = { initialRouteName: 'index' };

/** Management belongs to Yours; keep the real five-tab navigation mounted. */
export default function YoursLayout() {
  return <Stack screenOptions={{ headerShown: false, freezeOnBlur: false }} />;
}
