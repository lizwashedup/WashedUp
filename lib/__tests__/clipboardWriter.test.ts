import { Platform } from 'react-native';
import { getClipboardWriter } from '../clipboardWriter';

const mockNativeModule = jest.fn();
const mockClipboardImport = jest.fn();
jest.mock('expo', () => ({requireOptionalNativeModule: (name:string) => mockNativeModule(name)}));
jest.mock('expo-clipboard', () => { mockClipboardImport(); return {setStringAsync:jest.fn()}; });

it('can display the older binary’s fallback without initializing an unsupported native module', () => {
  const platform=Platform.OS;
  try {
    Platform.OS='ios';
    mockNativeModule.mockReturnValue(null);
    expect(getClipboardWriter()).toBeNull();
    expect(mockClipboardImport).not.toHaveBeenCalled();
    mockNativeModule.mockReturnValue({setStringAsync:jest.fn()});
    expect(typeof getClipboardWriter()).toBe('function');
  } finally { Platform.OS=platform; }
});
