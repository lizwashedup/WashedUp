import React from 'react';
import { Dimensions, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
jest.mock('../../../hooks/useAfterglowFonts', () => ({ useAfterglowFonts: () => ({ fonts: require('../../../constants/Typography').AfterglowFallbackFonts }) }));
jest.mock('../../ProfileButton', () => () => require('react').createElement(require('react-native').Pressable, { accessibilityLabel: 'Profile', onPress: jest.fn() }));
import { CreatorScreenHeader } from '../CreatorScreenHeader';

it('keeps the full creator identity and the same Back/Profile controls at large text sizes', () => {
  const previous = Dimensions.get('window'); const back = jest.fn(); let tree: ReactTestRenderer | undefined;
  try {
    act(() => Dimensions.set({ window: { ...previous, width: 320, fontScale: 1 } }));
    act(() => { tree = create(<CreatorScreenHeader title="Local Sunset Club" onBack={back} backLabel="Back to managing Local Sunset Club" />); });
    const button = (label: string) => tree!.root.findAll(n => n.props.accessibilityLabel === label && n.props.onPress)[0];
    const backButton = button('Back to managing Local Sunset Club'), profile = button('Profile');
    act(() => Dimensions.set({ window: { ...previous, width: 320, fontScale: 3.2 } }));
    const title = tree!.root.findAllByType(Text).find(n => n.props.children === 'Local Sunset Club')!;
    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.allowFontScaling).not.toBe(false);
    expect(button('Back to managing Local Sunset Club')).toBe(backButton);
    expect(button('Profile')).toBe(profile);
    act(() => backButton.props.onPress()); expect(back).toHaveBeenCalledTimes(1);
  } finally { act(() => { tree?.unmount(); Dimensions.set({ window: previous }); }); }
});
