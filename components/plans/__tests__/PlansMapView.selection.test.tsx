import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import PlansMapView from '../PlansMapView';
import { Marker } from '../../MapView';
import type { Plan } from '../../../lib/fetchPlans';

jest.mock('../../MapView', () => ({ MapView: ({ children }: any) => children, Marker: () => null }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: async () => ({status: 'denied'}) }));
jest.mock('../../../lib/haptics', () => ({ hapticLight: jest.fn(), hapticSelection: jest.fn() }));
jest.mock('../../FilterBottomSheet', () => ({ FilterBottomSheet: () => null }));
const picnic = {id:'picnic', title:'Sunset picnic', start_time:'2040-05-04T17:00:00Z', location_lat:34,
  location_lng:-118, max_invites:5, member_count:2} as Plan;
it('updates the open card from current rows, drops a removed selection and requires a new tap when it returns', async () => {
  let tree!: ReactTestRenderer;
  const open = jest.fn();
  const screen = (plans: Plan[]) => <PlansMapView plans={plans} wishlistedSet={{}} onPlanPress={open} onClose={jest.fn()} />;
  await act(async () => { tree = create(screen([picnic])); });
  const text = () => tree.root.findAllByType(Text).map(t => t.props.children);
  const pin = () => tree.root.findByType(Marker).props.onPress();
  try {
    act(pin); expect(text()).toContain('Sunset picnic');
    act(() => tree.update(screen([{...picnic,title:'Updated picnic'}])));
    expect(text()).toContain('Updated picnic'); expect(text()).not.toContain('Sunset picnic');
    act(() => tree.update(screen([])));
    expect(text()).not.toContain('Updated picnic'); expect(text()).toContain('No plans to show on the map');
    expect(text()).toContain('There are no plans in this list right now.');
    act(() => tree.update(screen([{ ...picnic, location_lat: null }])));
    expect(text()).toContain('These plans don’t have map locations yet. You can still browse them in the list.');
    act(() => tree.update(screen([picnic])));
    expect(text()).not.toContain('Sunset picnic');
    act(pin); act(pin);
    expect(open.mock.calls).toEqual([['picnic']]);
  } finally { act(() => tree.unmount()); }
});
