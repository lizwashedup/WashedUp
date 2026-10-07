import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal, StyleSheet, Text } from 'react-native';
import { Image } from 'expo-image';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import * as Location from 'expo-location';
import PlacePicker, { type PlaceValue } from '../place/PlacePicker';
import { addRecentPlace, loadRecentPlaces, type RecentPlace } from '../place/recentPlaces';
import { AfterglowFonts, Fonts } from '../../../constants/Typography';
import { AfterglowColors } from '../../../constants/Colors';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('react-native-google-places-autocomplete', () => ({ GooglePlacesAutocomplete: () => null }));
jest.mock('expo-location', () => ({ getLastKnownPositionAsync: jest.fn(), reverseGeocodeAsync: jest.fn() }));
jest.mock('../place/recentPlaces', () => ({ loadRecentPlaces: jest.fn(), addRecentPlace: jest.fn(), relativeUsed: () => 'used yesterday' }));
jest.mock('../../../lib/googleMapsKey', () => ({ GOOGLE_MAPS_API_KEY: 'fixture-only' }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('lucide-react-native', () => ({ ChevronLeft: () => null, MapPin: () => null, Search: () => null }));

const appearance = { fonts: AfterglowFonts };
const cleanup: Array<() => void> = [];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
function mount(extra: Partial<React.ComponentProps<typeof PlacePicker>> = {}) {
  const change = jest.fn(); let props: React.ComponentProps<typeof PlacePicker> = { value: null, onChange: change, appearance, ...extra };
  let tree!: ReactTestRenderer, closed = false;
  act(() => { tree = create(<PlacePicker {...props} />); });
  const unmount = () => { if (!closed) act(() => tree.unmount()); closed = true; };
  cleanup.push(unmount);
  const button = (label: string) => tree.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  return { tree, change, button, unmount,
    open: () => act(() => { button(props.appearance ? props.value ? 'Change place' : 'Add a place (optional)' : props.value ? 'change place' : 'add a place (optional)').props.onPress(); }),
    update: (next: Partial<typeof props>) => { props = { ...props, ...next }; act(() => tree.update(<PlacePicker {...props} />)); },
    modal: () => tree.root.findByType(Modal),
    search: () => tree.root.findByType(GooglePlacesAutocomplete),
    text: () => tree.root.findAllByType(Text).map(node => node.props.children).flat().join(' '),
  };
}
const result = { structured_formatting: { main_text: 'Ocean Park', secondary_text: 'Santa Monica, CA' } };
const details = { geometry: { location: { lat: 34.01, lng: -118.48 } } };
const recent: RecentPlace = { name: 'A recent place', lat: null, lng: null, neighborhood: null, usedAt: 1 };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadRecentPlaces).mockResolvedValue([recent]); jest.mocked(addRecentPlace).mockResolvedValue();
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null);
  jest.mocked(Location.reverseGeocodeAsync).mockResolvedValue([{ district: 'Santa Monica' } as Location.LocationGeocodedAddress]);
});
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); });

it('preserves Google query, details, debounce and native stable pageSheet while adding 44px controls', async () => {
  const f = mount(); const modal = f.modal(); f.open(); await flush();
  expect(f.modal()).toBe(modal); expect(modal.props).toMatchObject({ visible: true, presentationStyle: 'pageSheet', animationType: 'slide' });
  expect(f.search().props).toMatchObject({ fetchDetails: true, debounce: 300, keepResultsAfterBlur: true,
    query: { key: 'fixture-only', language: 'en', components: 'country:us', location: '34.0522,-118.2437', radius: '50000' } });
  expect(StyleSheet.flatten(f.button('Cancel place search').props.style)).toMatchObject({ minHeight: 44, minWidth: 44 });
  expect(f.search().props.styles.textInput).toMatchObject({ fontFamily: AfterglowFonts.regular, minHeight: 48, borderRadius: 4 });
  const value: PlaceValue = { name: 'Chosen place', lat: null, lng: null, neighborhood: null };
  f.update({ value }); expect(f.modal()).toBe(modal); expect(modal.props.visible).toBe(true);
  expect(StyleSheet.flatten(f.button('Change place').props.style)).toMatchObject({ minHeight: 44, minWidth: 44 });
});

it('emits the original exact name/coordinates/neighborhood and persists the same recent value', async () => {
  const f = mount(); f.open(); await flush();
  await act(async () => { await f.search().props.onPress(result, details); });
  const expected = { name: 'Ocean Park', lat: 34.01, lng: -118.48, neighborhood: 'Santa Monica' };
  expect(f.change).toHaveBeenCalledTimes(1); expect(f.change).toHaveBeenCalledWith(expected);
  expect(addRecentPlace).toHaveBeenCalledWith(expected, expect.any(Number)); expect(f.modal().props.visible).toBe(false);
});

it('keeps name-only results selectable when coordinates or reverse-geocoding are unavailable', async () => {
  const f = mount(); f.open(); await flush();
  await act(async () => { await f.search().props.onPress({ description: 'A named place' }, null); });
  expect(f.change).toHaveBeenLastCalledWith({ name: 'A named place', lat: null, lng: null, neighborhood: null });
  expect(Location.reverseGeocodeAsync).not.toHaveBeenCalled();
  f.open(); jest.mocked(Location.reverseGeocodeAsync).mockRejectedValueOnce(new Error('unavailable'));
  await act(async () => { await f.search().props.onPress(result, details); });
  expect(f.change).toHaveBeenLastCalledWith({ name: 'Ocean Park', lat: 34.01, lng: -118.48, neighborhood: null });
});

it('preserves local recents and hides them while a query is being entered', async () => {
  const f = mount(); f.open(); await flush(); expect(f.button(recent.name)).toBeDefined();
  act(() => { f.search().props.textInputProps.onChangeText('Ocean'); }); expect(f.button(recent.name)).toBeUndefined();
  act(() => { f.search().props.textInputProps.onChangeText(''); });
  await act(async () => { f.button(recent.name).props.onPress(); await Promise.resolve(); });
  expect(f.change).toHaveBeenCalledWith({ name: recent.name, lat: null, lng: null, neighborhood: null });
  expect(f.modal().props.visible).toBe(false);
});

it.each(['cancel', 'native-close', 'unmount'] as const)('rejects a late reverse-geocode selection after %s', async route => {
  const geocode = deferred<Location.LocationGeocodedAddress[]>(); jest.mocked(Location.reverseGeocodeAsync).mockReturnValueOnce(geocode.promise);
  const f = mount(); f.open(); await flush(); let selecting!: Promise<void>;
  act(() => { selecting = f.search().props.onPress(result, details); }); expect(f.text()).toContain('Choosing place…');
  if (route === 'cancel') act(() => { f.button('Cancel place search').props.onPress(); });
  else if (route === 'native-close') act(() => { f.modal().props.onRequestClose(); }); else f.unmount();
  await act(async () => { geocode.resolve([]); await selecting; });
  expect(f.change).not.toHaveBeenCalled(); expect(addRecentPlace).not.toHaveBeenCalled();
});

it('does not let a retired result or close handler select into or dismiss a reopened picker', async () => {
  const geocode = deferred<Location.LocationGeocodedAddress[]>(); jest.mocked(Location.reverseGeocodeAsync).mockReturnValueOnce(geocode.promise);
  const f = mount(); f.open(); await flush(); const oldPick = f.search().props.onPress, oldClose = f.modal().props.onRequestClose;
  let selecting!: Promise<void>; act(() => { selecting = oldPick(result, details); oldClose(); });
  f.open(); await flush(); act(() => { oldClose(); }); expect(f.modal().props.visible).toBe(true);
  await act(async () => { geocode.resolve([]); await selecting; await oldPick(result, details); });
  expect(f.change).not.toHaveBeenCalled(); expect(f.modal().props.visible).toBe(true);
});

it('keeps the newest selected result when reverse-geocode responses finish out of order', async () => {
  const first = deferred<Location.LocationGeocodedAddress[]>(); jest.mocked(Location.reverseGeocodeAsync).mockReturnValueOnce(first.promise);
  const f = mount(); f.open(); await flush(); let old!: Promise<void>;
  act(() => { old = f.search().props.onPress(result, details); });
  await act(async () => { await f.search().props.onPress({ description: 'Second place' }, details); });
  await act(async () => { first.resolve([{ city: 'Old area' } as Location.LocationGeocodedAddress]); await old; });
  expect(f.change).toHaveBeenCalledTimes(1); expect(f.change.mock.calls[0][0].name).toBe('Second place');
});

it('does not let a completed old recent-place save dismiss a new picker visit', async () => {
  const save = deferred<void>(); jest.mocked(addRecentPlace).mockReturnValueOnce(save.promise);
  const f = mount(); f.open(); await flush(); let selecting!: Promise<void>;
  act(() => { selecting = f.search().props.onPress({ description: 'Name-only place' }, null); });
  expect(f.change).toHaveBeenCalledTimes(1); act(() => { f.button('Cancel place search').props.onPress(); }); f.open(); await flush();
  await act(async () => { save.resolve(); await selecting; }); expect(f.modal().props.visible).toBe(true);
});

it('ignores retired recent-place loads rather than overwriting the reopened visit', async () => {
  const old = deferred<RecentPlace[]>(); jest.mocked(loadRecentPlaces).mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ ...recent, name: 'Current recent' }]);
  const f = mount(); f.open(); await flush(); act(() => { f.button('Cancel place search').props.onPress(); }); f.open(); await flush();
  await act(async () => { old.resolve([{ ...recent, name: 'Old recent' }]); });
  expect(f.button('Current recent')).toBeDefined(); expect(f.button('Old recent')).toBeUndefined();
});

it('shows only supplied location metadata and wraps a long chosen place title', async () => {
  const name = 'A very long place name that needs to remain readable'; const f = mount({ value: { name, lat: null, lng: null, neighborhood: null } }); await flush();
  expect(f.text()).not.toContain('Los Angeles');
  const title = f.tree.root.findAllByType(Text).find(node => node.props.children === name)!;
  expect(title.props.numberOfLines).toBeUndefined(); expect(StyleSheet.flatten(title.props.style).fontFamily).toBe(AfterglowFonts.semibold);
  f.update({ value: { name, lat: null, lng: null, neighborhood: 'Pasadena' } }); expect(f.text()).toContain('Pasadena');
});

it('falls back after a map failure and prevents its old callback hiding a replacement map', async () => {
  const f = mount({ value: { name: 'Park', lat: 34, lng: -118, neighborhood: null } }); await flush();
  const photo = f.tree.root.findByType(Image), oldFailure = photo.props.onError;
  expect(photo.props.source.uri).toContain(`color:0x${AfterglowColors.clay.replace('#', '')}`);
  act(() => { oldFailure(); }); expect(f.tree.root.findAllByType(Image)).toHaveLength(0);
  f.update({ value: { name: 'Another park', lat: 35, lng: -119, neighborhood: null } });
  act(() => { oldFailure(); }); expect(f.tree.root.findByType(Image).props.source.uri).toContain('center=35,-119');
});

it('preserves default visual tokens and optional-place entry', async () => {
  const f = mount({ appearance: undefined });
  const add = f.button('add a place (optional)'); expect(StyleSheet.flatten(add.props.style).borderRadius).toBe(12);
  f.open(); await flush(); expect(f.search().props.styles.textInput.fontFamily).toBe(Fonts.sans);
});
