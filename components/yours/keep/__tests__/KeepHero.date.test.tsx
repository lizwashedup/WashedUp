import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import KeepHero from '../KeepHero';
import { AfterglowFallbackFonts } from '../../../../constants/Typography';
jest.mock('expo-image', () => ({ Image: (props: any) => require('react').createElement('Photo', props) }));
const appearance = { fonts: AfterglowFallbackFonts };
const props = { myName: 'Liz', myPhoto: null, theirName: 'Amelia', theirPhoto: null, plansCount: 1, albumsCount: 0, comingUpCount: 0, sinceDate: '2026-06-15T12:00:00Z' };
const cleanup: Array<() => void> = [];
function text(visual: boolean, sinceDate = props.sinceDate) {
  let tree!: ReturnType<typeof create>; act(() => { tree = create(<KeepHero {...props} sinceDate={sinceDate} appearance={visual ? appearance : undefined} />); });
  cleanup.push(() => act(() => tree.unmount()));
  return tree.root.findAllByType(Text).map(n => n.props.children).flat().filter(n => typeof n === 'string').join(' ');
}
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
it('capitalizes the staged shared-history month', () => { expect(text(true)).toContain('Shared plans since June 2026'); });
it('preserves the legacy lowercase history copy', () => { expect(text(false)).toContain('kept since june 2026'); });
it('still omits malformed historical dates', () => { const value = text(true, 'bad-date'); expect(value).not.toContain('Invalid Date'); expect(value).not.toContain('Shared plans since'); });
