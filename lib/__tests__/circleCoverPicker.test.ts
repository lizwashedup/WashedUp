import { Platform } from 'react-native';
import * as Picker from 'expo-image-picker';
import * as Manipulator from 'expo-image-manipulator';
import { pickCoverPhoto } from '../circles/pickCover';

jest.mock('expo-image-picker', () => ({ requestMediaLibraryPermissionsAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));

const initialOS = Platform.OS;
afterEach(() => { Platform.OS = initialOS; jest.resetAllMocks(); });

it('opens the iPhone picker without library access and prepares only the chosen photo', async () => {
  Platform.OS = 'ios';
  jest.mocked(Picker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///selected.jpg', width: 500, height: 800 }] });
  jest.mocked(Manipulator.manipulateAsync).mockResolvedValue({ base64: 'sample', uri: 'file:///prepared.jpg', width: 1200, height: 1920 });
  await expect(pickCoverPhoto()).resolves.toEqual({ base64: 'sample', uri: 'file:///prepared.jpg' });
  expect(Picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  expect(Manipulator.manipulateAsync).toHaveBeenCalledWith('file:///selected.jpg', [{ resize: { width: 1200 } }], expect.objectContaining({ base64: true }));
});

it('leaves the previous cover alone on iPhone picker cancellation', async () => {
  Platform.OS = 'ios';
  jest.mocked(Picker.launchImageLibraryAsync).mockResolvedValue({ canceled: true, assets: null });
  await expect(pickCoverPhoto()).resolves.toBeNull();
  expect(Manipulator.manipulateAsync).not.toHaveBeenCalled();
});

it('preserves the existing Android permission decision', async () => {
  Platform.OS = 'android';
  jest.mocked(Picker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: false } as Picker.MediaLibraryPermissionResponse);
  await expect(pickCoverPhoto()).resolves.toBeNull();
  expect(Picker.launchImageLibraryAsync).not.toHaveBeenCalled();
});
