import React from 'react';
import { act, create } from 'react-test-renderer';
import { Modal, Platform, Text, TouchableOpacity } from 'react-native';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('../../../../hooks/useProfile', () => ({ invalidateAuthProfile: jest.fn() }));
jest.mock('../../../../lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })) } },
}));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({ SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: jest.fn() }));

import * as Picker from 'expo-image-picker';
import * as Manipulator from 'expo-image-manipulator';
import { supabase } from '../../../../lib/supabase';
import { BrandedAlert } from '../../../../components/BrandedAlert';
import Photo from '../photo';
import ProgressHead from '../../../../components/onboarding/ProgressHead';

function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>(r => { resolve = r; });
  return { promise, resolve };
}
let tree: ReturnType<typeof create>;
let unmounted: boolean;
const initialOS = Platform.OS;
function button(label: string) {
  return tree.root.findAllByType(TouchableOpacity).find(b =>
    b.findAllByType(Text).some(t => t.props.children === label))!;
}
function modal() {
  // The screen renders the photo chooser after its separate BrandedAlert.
  return tree.root.findAllByType(Modal).slice(-1)[0]!;
}
async function open() {
  await act(async () => {
    tree.root.findAllByType(TouchableOpacity).find(b =>
      !b.props.disabled && b.findAll(n => n.props.name === 'add').length > 0)!.props.onPress();
  });
}
beforeEach(async () => {
  jest.clearAllMocks();
  (Platform as any).OS = 'ios';
  unmounted = false;
  (Manipulator.manipulateAsync as jest.Mock).mockResolvedValue({ uri: 'file:///processed.jpg', base64: 'cGhvdG8=' });
  (Picker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Picker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Picker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true });
  (Picker.launchCameraAsync as jest.Mock).mockResolvedValue({ canceled: true });
  await act(async () => { tree = create(<Photo />); });
  await open();
});
afterEach(async () => {
  if (!unmounted) await act(async () => tree.unmount());
  (Platform as any).OS = initialOS;
});

it.each(['choose from library', 'take photo'])('waits for native dismissal before %s permission/picker', async label => {
  await act(async () => { button(label).props.onPress(); });
  expect(Picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  expect(Picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => { modal().props.onDismiss?.(); });
  expect(label === 'take photo' ? Picker.launchCameraAsync : Picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
});
it('dispatches one picker after repeated same-tick taps', async () => {
  const press = button('choose from library').props.onPress;
  await act(async () => { press(); press(); });
  await act(async () => { modal().props.onDismiss?.(); modal().props.onDismiss?.(); });
  expect(Picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
});
it.each(['Back', 'unmount'])('ignores late permission after %s', async exit => {
  const permission = deferred();
  (Picker.requestMediaLibraryPermissionsAsync as jest.Mock).mockReturnValue(permission.promise);
  await chooseLibrary();
  expect(Picker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    if (exit === 'Back') tree.root.findByType(ProgressHead).props.onBack();
    else { tree.unmount(); unmounted = true; }
  });
  await act(async () => { permission.resolve({ status: 'granted' }); });
  expect(Picker.launchImageLibraryAsync).not.toHaveBeenCalled();
});

async function chooseLibrary() {
  await act(async () => { button('choose from library').props.onPress(); });
  await act(async () => { modal().props.onDismiss?.(); });
}
function emitAccount(event: string, id: string | null) {
  for (const [callback] of (supabase.auth.onAuthStateChange as jest.Mock).mock.calls) {
    callback(event, id ? { user: { id } } : null);
  }
}
it('cancel opens no native picker and allows a fresh attempt', async () => {
  await act(async () => { modal().props.onRequestClose(); });
  await act(async () => { modal().props.onDismiss?.(); });
  expect(Picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  await open(); await chooseLibrary();
  expect(Picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
});
it('old dismissal cannot consume a new chooser', async () => {
  const oldDismiss = modal().props.onDismiss;
  await act(async () => { modal().props.onRequestClose(); });
  await act(async () => { oldDismiss?.(); });
  await open();
  await act(async () => { button('choose from library').props.onPress(); oldDismiss?.(); });
  expect(Picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  await act(async () => { modal().props.onDismiss?.(); });
  expect(Picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
});
it('Android opens the picker after the hidden state commits without waiting for onDismiss', async () => {
  (Platform as any).OS = 'android';
  await act(async () => { button('choose from library').props.onPress(); });
  expect(modal().props.visible).toBe(false);
  expect(Picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
});
it('denied permission is recoverable and never launches the picker', async () => {
  (Picker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValueOnce({status:'denied'});
  await chooseLibrary();
  expect(Picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(tree.root.findByType(BrandedAlert).props.title).toBe('permission needed');
  await act(async () => { tree.root.findByType(BrandedAlert).props.onClose(); });
  await open(); await chooseLibrary();
  expect(Picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
});
it('account switch retires an outstanding permission result', async () => {
  const permission = deferred();
  (Picker.requestMediaLibraryPermissionsAsync as jest.Mock).mockReturnValueOnce(permission.promise);
  await act(async () => { emitAccount('INITIAL_SESSION','member-a'); });
  await chooseLibrary();
  await act(async () => { emitAccount('SIGNED_IN','member-b'); permission.resolve({status:'granted'}); });
  expect(Picker.launchImageLibraryAsync).not.toHaveBeenCalled();
});
it('late library selection after Back cannot start image processing', async () => {
  const selection = deferred();
  (Picker.launchImageLibraryAsync as jest.Mock).mockReturnValueOnce(selection.promise);
  await chooseLibrary();
  await act(async () => { tree.root.findByType(ProgressHead).props.onBack(); selection.resolve({canceled:false,assets:[{uri:'file:///photo.jpg'}]}); });
  expect(Manipulator.manipulateAsync).not.toHaveBeenCalled();
});
it('late image processing after Back cannot enable Continue', async () => {
  const processing = deferred();
  (Picker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({canceled:false,assets:[{uri:'file:///photo.jpg'}]});
  (Manipulator.manipulateAsync as jest.Mock).mockReturnValueOnce(processing.promise);
  await chooseLibrary();
  expect(Manipulator.manipulateAsync).toHaveBeenCalledTimes(1);
  await act(async () => { tree.root.findByType(ProgressHead).props.onBack(); processing.resolve({uri:'file:///processed.jpg',base64:'cGhvdG8='}); });
  expect(button('continue').props.disabled).toBe(true);
});
it('successful processing retains the photo and enables Continue', async () => {
  (Picker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({canceled:false,assets:[{uri:'file:///photo.jpg'}]});
  await chooseLibrary();
  expect(Manipulator.manipulateAsync).toHaveBeenCalledTimes(1);
  expect(button('continue').props.disabled).toBe(false);
});
