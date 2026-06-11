/**
 * pickCoverPhoto - pick + compress a single image for a circle cover. Mirrors
 * the proven composer photo path (ImagePicker -> ImageManipulator base64). Returns
 * null on permission denial or cancel. The caller uploads the base64 to
 * circle-covers and points cover_upload_id at it.
 */
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

export async function pickCoverPhoto(): Promise<{ base64: string; uri: string } | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [16, 10],
    quality: 1,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const manipulated = await ImageManipulator.manipulateAsync(
    res.assets[0].uri,
    [{ resize: { width: 1200 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) return null;
  return { base64: manipulated.base64, uri: manipulated.uri };
}
