import React from 'react';
import { act, create } from 'react-test-renderer';
import { Modal, Platform, Text, TouchableOpacity } from 'react-native';

const mockReplace = jest.fn();
const mockUpdate = jest.fn();
const mockReceipt = jest.fn();
const mockRead = jest.fn();
const mockFilter = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@tanstack/react-query', () => ({ ...jest.requireActual('@tanstack/react-query'), useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('../../../../hooks/useProfile', () => ({ ...jest.requireActual('../../../../hooks/useProfile'), invalidateAuthProfile: jest.fn() }));
jest.mock('../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), auth: { onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })) } },
}));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({ SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: jest.fn() }));

jest.mock('../../../../lib/uploadPhoto', () => ({uploadBase64ToStorage:jest.fn()}));
jest.mock('../../../../lib/authGate', () => ({getUserBounded:jest.fn(async()=>({user:{id:'member-a'},resolved:true}))}));
import { getUserBounded } from '../../../../lib/authGate';
import { uploadBase64ToStorage } from '../../../../lib/uploadPhoto';
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
  jest.useFakeTimers();
  (uploadBase64ToStorage as jest.Mock).mockResolvedValue('https://example.invalid/test-photo.jpg');
  (getUserBounded as jest.Mock).mockResolvedValue({user:{id:'member-a'},resolved:true});
  mockRead.mockResolvedValue({data:{onboarding_status:'photo'},error:null});
  mockReceipt.mockResolvedValue({data:{id:'member-a'},error:null});
  (supabase.from as jest.Mock).mockImplementation(() => {
    let writing = false;
    const result = () => writing ? mockReceipt() : mockRead();
    const chain: any = {select:()=>chain,eq:()=>chain,or:(value:string)=>{mockFilter(value);return chain;},update:(fields:any)=>{writing=true;mockUpdate(fields);return chain;},maybeSingle:result,single:result,then:(yes:any,no:any)=>result().then(yes,no)};
    return chain;
  });
  (Platform as any).OS = 'ios';
  unmounted = false;
  (Manipulator.manipulateAsync as jest.Mock).mockResolvedValue({ uri: 'file:///processed.jpg', base64: 'cGhvdG8=' });
  (Picker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Picker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Picker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets:[{uri:'file:///photo.jpg'}] });
  (Picker.launchCameraAsync as jest.Mock).mockResolvedValue({ canceled: true });
  await act(async () => { tree = create(<Photo />); });
  await open();
  await act(async () => { button('choose from library').props.onPress(); });
  await act(async () => { modal().props.onDismiss?.(); });
  expect(button('continue').props.disabled).toBe(false);
});
afterEach(async () => {
  if (!unmounted) await act(async () => tree.unmount());
  (Platform as any).OS = initialOS;
  jest.useRealTimers();
});


it('advances after a matching profile-save receipt', async () => {
  await act(async () => { await button('continue').props.onPress(); });
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plans');
});
it('does not advance after an unconfirmed profile update', async () => {
  mockReceipt.mockResolvedValue({data:null,error:null});
  await act(async () => { await button('continue').props.onPress(); });
  expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)/plans');
  expect(tree.root.findByType(BrandedAlert).props.visible).toBe(true);
});
it('Back during upload prevents a late profile write', async () => {
  const upload=deferred();(uploadBase64ToStorage as jest.Mock).mockReturnValueOnce(upload.promise);
  let pending!:Promise<void>;
  await act(async () => { pending=button('continue').props.onPress(); });
  await act(async () => { tree.root.findByType(ProgressHead).props.onBack(); });
  await act(async () => { upload.resolve('https://example.invalid/test-photo.jpg');await pending; });
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockReplace.mock.calls).toEqual([['/onboarding/referral']]);
});
it('Back during profile update ignores its late receipt', async () => {
  const receipt=deferred();mockReceipt.mockReturnValueOnce(receipt.promise);
  let pending!:Promise<void>;
  await act(async () => { pending=button('continue').props.onPress(); });
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  await act(async () => { tree.root.findByType(ProgressHead).props.onBack(); });
  await act(async () => { receipt.resolve({data:{id:'member-a'},error:null});await pending; });
  expect(mockReplace.mock.calls).toEqual([['/onboarding/referral']]);
});
it('a stalled upload releases loading and keeps the photo for retry', async () => {
  const upload=deferred();(uploadBase64ToStorage as jest.Mock).mockReturnValueOnce(upload.promise);
  await act(async () => { void button('continue').props.onPress(); });
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(tree.root.findByType(BrandedAlert).props.visible).toBe(true);
  expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)/plans');
});

function emitAccount(event: string, id: string | null) {
  for (const [callback] of (supabase.auth.onAuthStateChange as jest.Mock).mock.calls) {
    callback(event, id ? { user: { id } } : null);
  }
}
async function startSave() {
  let pending!: Promise<void>;
  await act(async () => { pending = button('continue').props.onPress(); });
  return {pending};
}
it('completed account skips upload and leaves the existing photo untouched', async () => {
  mockRead.mockResolvedValue({data:{onboarding_status:'complete'},error:null});
  await act(async () => { await button('continue').props.onPress(); });
  expect(uploadBase64ToStorage).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plans');
});
it('a lost save receipt is recovered by a fresh completion read', async () => {
  mockRead.mockResolvedValueOnce({data:{onboarding_status:'photo'},error:null}).mockResolvedValueOnce({data:{onboarding_status:'complete'},error:null});
  mockReceipt.mockResolvedValue({data:null,error:{message:'lost response'}});
  await act(async () => { await button('continue').props.onPress(); });
  expect(mockFilter).toHaveBeenCalledWith('onboarding_status.is.null,onboarding_status.neq.complete');
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)/plans');
});
it('wrong-member receipt does not advance', async () => {
  mockReceipt.mockResolvedValue({data:{id:'member-b'},error:null});
  await act(async () => { await button('continue').props.onPress(); });
  expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)/plans');
});
it.each(['account switch','sign out','unmount'])('upload completion after %s cannot write or navigate', async exit => {
  const upload=deferred();(uploadBase64ToStorage as jest.Mock).mockReturnValueOnce(upload.promise);
  await act(async () => { emitAccount('INITIAL_SESSION','member-a'); });
  const {pending}=await startSave();
  await act(async () => {
    if(exit==='unmount'){tree.unmount();unmounted=true;}
    else emitAccount(exit==='sign out'?'SIGNED_OUT':'SIGNED_IN',exit==='sign out'?null:'member-b');
  });
  await act(async () => { upload.resolve('https://example.invalid/test-photo.jpg');await pending; });
  expect(mockUpdate).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();
});
it('timeout retry reuses the original immutable object path', async () => {
  const upload=deferred();(uploadBase64ToStorage as jest.Mock).mockReturnValueOnce(upload.promise);
  await startSave();
  await act(async () => { jest.advanceTimersByTime(20001); });
  await act(async () => { tree.root.findByType(BrandedAlert).props.onClose(); });
  expect(button('continue').props.disabled).toBe(false);
  await act(async () => { await button('continue').props.onPress(); });
  const calls=(uploadBase64ToStorage as jest.Mock).mock.calls;
  expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);
  expect(calls[0][3]).toEqual({upsert:false,existingIsSuccess:true});
  await act(async () => { upload.resolve('https://example.invalid/late.jpg'); });
  expect(mockUpdate).toHaveBeenCalledTimes(1);expect(mockReplace).toHaveBeenCalledTimes(1);
});
it('profile-save retry keeps its confirmed upload without reuploading', async () => {
  mockReceipt.mockResolvedValueOnce({data:null,error:{message:'offline'}});
  await act(async () => { await button('continue').props.onPress(); });
  await act(async () => { tree.root.findByType(BrandedAlert).props.onClose(); });
  await act(async () => { await button('continue').props.onPress(); });
  expect(uploadBase64ToStorage).toHaveBeenCalledTimes(1);
  expect(mockUpdate.mock.calls[0]).toEqual(mockUpdate.mock.calls[1]);
  expect(mockReplace).toHaveBeenCalledTimes(1);
});
it('same-tick duplicate taps create one upload and one save', async () => {
  const press=button('continue').props.onPress;
  await act(async () => { await Promise.all([press(),press()]); });
  expect(uploadBase64ToStorage).toHaveBeenCalledTimes(1);expect(mockUpdate).toHaveBeenCalledTimes(1);
});
it('expired auth response after refresh does not sign out or upload', async () => {
  const auth=deferred();(getUserBounded as jest.Mock).mockReturnValueOnce(auth.promise);
  const {pending}=await startSave();
  await act(async () => { emitAccount('TOKEN_REFRESHED','member-a');auth.resolve({user:null,resolved:true});await pending; });
  expect(uploadBase64ToStorage).not.toHaveBeenCalled();expect(mockReplace).not.toHaveBeenCalled();
  expect(tree.root.findByType(BrandedAlert).props.visible).toBe(false);
});
it('a stalled profile write releases loading; late receipt cannot navigate', async () => {
  const receipt=deferred();mockReceipt.mockReturnValueOnce(receipt.promise);
  await startSave();
  await act(async () => { jest.advanceTimersByTime(4001); });
  expect(tree.root.findByType(BrandedAlert).props.visible).toBe(true);
  await act(async () => { receipt.resolve({data:{id:'member-a'},error:null}); });
  expect(mockReplace).not.toHaveBeenCalled();
});
it('failed preflight does not upload or mutate a profile', async () => {
  mockRead.mockResolvedValue({data:null,error:{message:'offline'}});
  await act(async () => { await button('continue').props.onPress(); });
  expect(uploadBase64ToStorage).not.toHaveBeenCalled();expect(mockUpdate).not.toHaveBeenCalled();
  expect(tree.root.findByType(BrandedAlert).props.visible).toBe(true);
});
