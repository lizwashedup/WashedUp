import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { act, create } from 'react-test-renderer';
import KeepHero from '../KeepHero';
import StoryTimeline from '../StoryTimeline';
import { AfterglowFallbackFonts, AfterglowType } from '../../../../constants/Typography';
import type { ProfileCardAdventure } from '../../../../lib/yours/types';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('expo-image', () => ({ Image: (props: any) => require('react').createElement('Photo', props) }));
const cleanup: Array<() => void> = [];
const appearance = { fonts: AfterglowFallbackFonts };
function mount(element: React.ReactElement) { let tree!: ReturnType<typeof create>; act(() => { tree = create(element); }); cleanup.push(() => act(() => tree.unmount())); return { tree, text: () => tree.root.findAllByType(Text).map(n => n.props.children).flat().filter(n => typeof n !== 'object').join(' '), update: (next: React.ReactElement) => act(() => tree.update(next)) }; }
const hero = { myName: 'Liz', myPhoto: 'https://example.invalid/liz.jpg', theirName: 'Amelia', theirPhoto: 'https://example.invalid/amelia.jpg', plansCount: 3, albumsCount: 2, comingUpCount: 1, sinceDate: '2026-01-15', appearance };
const album = (event_id: string, date: string, title: string): ProfileCardAdventure => ({ album_id: `album-${event_id}`, event_id, date, title, thumb_url: null });
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); jest.clearAllMocks(); });
it('keeps two independent full-color real photos and compact72px photo geometry', () => {
  const f = mount(<KeepHero {...hero} />); const photos = f.tree.root.findAllByType('Photo' as any);
  expect(photos.map(n => n.props.source.uri)).toEqual([hero.myPhoto, hero.theirPhoto]); expect(photos.every(n => StyleSheet.flatten(n.props.style).opacity === 1)).toBe(true);
  const face = f.tree.root.findAll(n => StyleSheet.flatten(n.props.style)?.width === 72); expect(face.length).toBeGreaterThan(0);
});
it('a failed portrait gets its own initial, and a replacement picture is not poisoned by old errors', () => {
  const f = mount(<KeepHero {...hero} />); const oldError = f.tree.root.findAllByType('Photo' as any)[1].props.onError;
  act(() => oldError()); expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(1); expect(f.text()).toContain('A');
  f.update(<KeepHero {...hero} theirPhoto="https://example.invalid/new.jpg" />); act(() => oldError()); expect(f.tree.root.findAllByType('Photo' as any)[1].props.source.uri).toContain('new.jpg');
});
it('retains supplied counts without implying their upcoming plans are shared', () => {
  const f = mount(<KeepHero {...hero} />); expect(f.text()).toContain('shared plans'); expect(f.text()).toContain('albums'); expect(f.text()).toContain('upcoming plans'); expect(f.text()).toContain('Shared plans since'); expect(f.text()).not.toContain('kept since');
});
it('omits zero stats and malformed historical dates while long names remain readable', () => {
  const name = 'Amelia Alexandra de la Cruz'; const f = mount(<KeepHero {...hero} theirName={name} sinceDate="bad-date" plansCount={0} albumsCount={0} comingUpCount={0} />);
  expect(f.text()).not.toContain('Invalid Date'); expect(f.text()).not.toContain('shared plans'); const title = f.tree.root.findAllByType(Text).find(n => n.props.children === name)!;
  expect(title.props.numberOfLines).toBeUndefined(); expect(StyleSheet.flatten(title.props.style).fontFamily).toBe(AfterglowFallbackFonts.display);
});
it('respects hideStats even when counts are supplied', () => {
  const f = mount(<KeepHero {...hero} hideStats />); expect(f.text()).not.toContain('upcoming plans'); expect(f.text()).not.toContain('albums');
});
it('timeline preserves latest-first ordering and album routes using event ids', () => {
  const data = [album('older', '2026-01-02', 'Old album'), album('recent', '2026-08-04', 'Recent album')]; const f = mount(<StoryTimeline adventures={data} theirName="Amelia" appearance={appearance} />);
  const rows = f.tree.root.findAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function');
  expect(rows[0].props.accessibilityLabel).toContain('Recent album'); act(() => rows[0].props.onPress()); expect(mockPush).toHaveBeenCalledWith('/album/recent');
});
it('never calls the oldest album-backed memory the first plan in the staged timeline', () => {
  const f = mount(<StoryTimeline adventures={[album('older', '2026-01-02', 'Old album')]} theirName="Amelia" appearance={appearance} />);
  expect(f.text()).toContain('Old album'); expect(f.text()).not.toContain('first plan'); expect(f.text()).not.toContain('the beginning');
});
it('keeps parent-scoped album navigation and readable long memory titles', () => {
  const onOpenAlbum = jest.fn(), title = 'A very long shared plan title for several lines of history'; const f = mount(<StoryTimeline adventures={[album('event-id', '2026-01-02', title)]} theirName="Amelia" appearance={appearance} onOpenAlbum={onOpenAlbum} />);
  const row = f.tree.root.findAll(n => n.props.accessibilityLabel === `${title}, open album` && typeof n.props.onPress === 'function')[0]; act(() => row.props.onPress());
  expect(onOpenAlbum).toHaveBeenCalledWith('event-id'); expect(mockPush).not.toHaveBeenCalled();
  const text = f.tree.root.findAllByType(Text).find(n => n.props.children === title)!; expect(text.props.numberOfLines).toBeUndefined(); expect(StyleSheet.flatten(text.props.style)).toMatchObject({ ...AfterglowType.title, fontFamily: AfterglowFallbackFonts.semibold });
});
it('an empty timeline is an invitation with no fabricated album or first-plan marker', () => {
  const f = mount(<StoryTimeline adventures={[]} theirName="Amelia" appearance={appearance} />); expect(f.text()).toContain('More memories to make'); expect(f.text()).toContain('Invite Amelia'); expect(f.tree.root.findAll(n => typeof n.props.onPress === 'function')).toHaveLength(0);
});
it('staged memories show the supplied album covers in newest-first order without altering the data or destination', () => {
  const earlier = { ...album('older', '2026-01-02', 'Earlier album'), thumb_url: 'https://example.invalid/older-cover.jpg' };
  const later = { ...album('recent', '2026-08-04', 'Recent album'), thumb_url: 'https://example.invalid/recent-cover.jpg' };
  const data = [earlier, later], onOpenAlbum = jest.fn();
  const f = mount(<StoryTimeline adventures={data} theirName="Amelia" appearance={appearance} onOpenAlbum={onOpenAlbum}/>);
  const photos = f.tree.root.findAllByType('Photo' as any);
  expect(photos.map(photo => photo.props.source.uri)).toEqual([later.thumb_url, earlier.thumb_url]);
  expect(photos.every(photo => StyleSheet.flatten(photo.props.style).opacity === 1)).toBe(true);
  expect(photos.every(photo => StyleSheet.flatten(photo.props.style).width === 54)).toBe(true);
  expect(data).toEqual([earlier, later]);
  const row = f.tree.root.findAll(n => n.props.accessibilityLabel === 'Recent album, open album' && typeof n.props.onPress === 'function')[0];
  act(() => row.props.onPress()); expect(onOpenAlbum).toHaveBeenCalledWith('recent');
});
it('a failed memory cover becomes an initial and cannot poison a new cover or album identity', () => {
  const data = { ...album('event-one', '2026-01-02', 'Sunset volleyball'), thumb_url: 'https://example.invalid/broken.jpg' };
  const f = mount(<StoryTimeline adventures={[data]} theirName="Amelia" appearance={appearance}/>);
  const oldFailure = f.tree.root.findAllByType('Photo' as any)[0].props.onError;
  act(() => oldFailure()); expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(0); expect(f.text()).toContain('S');
  f.update(<StoryTimeline adventures={[{ ...data, thumb_url: 'https://example.invalid/replacement.jpg' }]} theirName="Amelia" appearance={appearance}/>);
  act(() => oldFailure()); expect(f.tree.root.findAllByType('Photo' as any)[0].props.source.uri).toContain('replacement.jpg');
  f.update(<StoryTimeline adventures={[{ ...data, album_id: 'new-album', event_id: 'event-two', title: 'Coffee together' }]} theirName="Amelia" appearance={appearance}/>);
  act(() => oldFailure()); expect(f.tree.root.findAllByType('Photo' as any)[0].props.source.uri).toBe(data.thumb_url);
  expect(f.text()).toContain('Coffee together');
});
it('missing album covers retain a 54px fallback while legacy rows do not acquire thumbnails', () => {
  const missing = album('event', '2026-01-02', 'Coffee at the park');
  const f = mount(<StoryTimeline adventures={[missing]} theirName="Amelia" appearance={appearance}/>);
  expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(0);
  expect(f.text()).toContain('C');
  const frame = f.tree.root.findAll(n => StyleSheet.flatten(n.props.style)?.width === 54)[0];
  expect(StyleSheet.flatten(frame.props.style)).toMatchObject({ width: 54, height: 54, borderRadius: 5 });
  f.update(<StoryTimeline adventures={[{ ...missing, thumb_url: 'https://example.invalid/cover.jpg' }]} theirName="Amelia"/>);
  expect(f.tree.root.findAllByType('Photo' as any)).toHaveLength(0);
});
it('uses natural month casing for staged memory dates and preserves legacy casing', () => {
  const date = '2026-08-04T12:00:00Z', entry = album('event', date, 'A shared memory');
  const label = new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const f = mount(<StoryTimeline adventures={[entry]} theirName="Amelia" appearance={appearance}/>);
  expect(f.text()).toContain(label);
  f.update(<StoryTimeline adventures={[entry]} theirName="Amelia"/>);
  expect(f.text()).toContain(label.toLowerCase());
});
it('legacy timeline/hero appearance remains opt-out', () => {
  const f = mount(<StoryTimeline adventures={[album('older', '2026-01-02', 'Old album')]} theirName="Amelia" />); expect(f.text()).toContain('first plan');
  const h = mount(<KeepHero {...hero} appearance={undefined} />); expect(h.text()).toContain('kept since');
});
