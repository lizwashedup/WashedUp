import React from 'react';
import { Text, StyleSheet, TouchableOpacity, Share, Platform } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { PlanCard } from '../PlanCard';
import { toPlanCardPlan } from '../../../lib/creatorMarks';
import type { Plan } from '../../../lib/fetchPlans';
import { AfterglowFonts, Fonts } from '../../../constants/Typography';
import { AfterglowColors } from '../../../constants/Colors';

const mockPush = jest.fn();
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text: MockText } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

describe('staged plan card appearance preserves the established card', () => {
  const appearance = { fonts: AfterglowFonts };
  const mounted: ReturnType<typeof create>[] = [];
  const mount = (props: Partial<React.ComponentProps<typeof PlanCard>> = {}) => {
    let card!: ReturnType<typeof create>;
    act(() => { card = create(<PlanCard plan={plan} {...props} />); });
    mounted.push(card);
    return card;
  };
  const titleStyle = (card: ReturnType<typeof create>) => StyleSheet.flatten(card.root.findAllByType(Text).find(n=>n.props.children===plan.title)!.props.style);
  const outer = (card: ReturnType<typeof create>) => card.root.findAllByType(TouchableOpacity).find(n=>n.props.onLongPress)!;
  afterEach(() => { act(() => mounted.splice(0).forEach(card=>card.unmount())); jest.clearAllMocks(); });

  it('uses the new fonts and restrained card corners only when opted in', () => {
    const legacy = mount(), staged = mount({ appearance });
    expect(titleStyle(legacy).fontFamily).toBe(Fonts.sansBold);
    expect(titleStyle(staged).fontFamily).toBe(AfterglowFonts.semibold);
    expect(titleStyle(staged).color).toBe(AfterglowColors.ink);
    expect(StyleSheet.flatten(outer(legacy).props.style).borderRadius).toBe(16);
    expect(StyleSheet.flatten(outer(staged).props.style).borderRadius).toBe(16);
    expect(renderedText(staged.root)).toEqual(renderedText(legacy.root));
  });

  it('keeps opening the same plan and exact creator profile', () => {
    const onCreatorPress = jest.fn(), card = mount({ appearance, onCreatorPress });
    act(() => { outer(card).props.onPress(); });
    expect(mockPush).toHaveBeenCalledWith('/plan/plan-1');
    const creator = card.root.findAllByType(TouchableOpacity).find(n=>StyleSheet.flatten(n.props.style)?.minWidth===0)!;
    act(() => { creator.props.onPress({stopPropagation:jest.fn()}); });
    expect(onCreatorPress).toHaveBeenCalledWith('creator-1');
  });

  it.each(['title-first', 'activity-first', 'creator-first'] as const)('keeps the %s title activation separate from creator and bookmark actions', layout => {
    const onCreatorPress = jest.fn(), onWishlist = jest.fn();
    const card = mount({ appearance, layout, onCreatorPress, onWishlist });
    expect(outer(card).props.accessible).toBe(false);
    const title = card.root.findAllByType(Text).find(node => node.props.children === plan.title)!;
    expect(title.props.accessibilityRole).toBe('button');
    act(() => title.props.onAccessibilityTap());
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/plan/plan-1');
    expect(onCreatorPress).not.toHaveBeenCalled(); expect(onWishlist).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'] as const)('retains %s card and title accessibility after the web-only container correction', os => {
    const platform = jest.replaceProperty(Platform, 'OS', os);
    try {
      const card = mount({ appearance });
      expect(outer(card).props.accessible).toBe(false);
      expect(outer(card).props.accessibilityRole).toBe('button');
      expect(outer(card).props.focusable).toBeUndefined();
      expect(outer(card).props.delayLongPress).toBe(500);
      const title = card.root.findAllByType(Text).find(node => node.props.children === plan.title)!;
      expect(title.props.accessibilityRole).toBe('button');
      expect(title.props.onPress).toBeUndefined();
      act(() => title.props.onAccessibilityTap());
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/plan/plan-1');
    } finally {
      platform.restore();
    }
  });

  it('bookmark controls keep the exact plan/current state and do not open the plan', () => {
    const onWishlist=jest.fn(), card=mount({appearance,onWishlist,isWishlisted:true});
    const save=card.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Remove from saved')!;
    const stopPropagation=jest.fn();
    act(()=>{save.props.onPress({stopPropagation});});
    expect(onWishlist).toHaveBeenCalledWith('plan-1',true);
    expect(stopPropagation).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(StyleSheet.flatten(save.props.style)).toMatchObject({minWidth:44,minHeight:44});
  });

  it.each(['pending', 'disabled'])('keeps the bookmark visible and inert while %s', kind => {
    const onWishlist = jest.fn();
    const card = mount({ appearance, onWishlist, wishlistPending: kind === 'pending', wishlistDisabled: kind === 'disabled' });
    const control = card.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === (kind === 'pending' ? 'Updating saved plan' : 'Save plan'))!;
    expect(control.props.disabled).toBe(true);
    act(() => control.props.onPress({stopPropagation: jest.fn()}));
    expect(onWishlist).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
    expect(control.props.accessibilityState).toMatchObject({disabled:true, busy:kind==='pending'});
  });

  it('share retains the existing payload without toggling a bookmark or joining', async () => {
    const share=jest.spyOn(Share,'share').mockResolvedValue({action:Share.sharedAction});
    const onWishlist=jest.fn(),card=mount({appearance,onWishlist});
    const control=card.root.findAllByType(TouchableOpacity).find(n=>n.props.accessibilityLabel==='Share plan')!;
    act(()=>{control.props.onPress({stopPropagation:jest.fn()});});
    expect(share).toHaveBeenCalledWith({message:expect.stringContaining(plan.title)});
    expect(onWishlist).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    share.mockRestore();
  });

  it('title-first keeps creator identity, content and actions while changing only reading order', () => {
    const onCreatorPress = jest.fn(), onWishlist = jest.fn();
    const control = mount({ appearance, onCreatorPress, onWishlist, layout: 'creator-first' });
    const candidate = mount({ appearance, onCreatorPress, onWishlist, layout: 'title-first' });
    const before = renderedText(control.root), after = renderedText(candidate.root);
    expect([...after].sort()).toEqual([...before].sort());
    expect(before.indexOf('Anna')).toBeLessThan(before.indexOf(plan.title));
    expect(after.indexOf(plan.title)).toBeLessThan(after.indexOf('Anna'));
    const creator = candidate.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === 'Open Anna profile')!;
    const save = candidate.root.findAllByType(TouchableOpacity).find(n => n.props.accessibilityLabel === 'Save plan')!;
    act(() => { creator.props.onPress({ stopPropagation: jest.fn() }); save.props.onPress({ stopPropagation: jest.fn() }); });
    expect(onCreatorPress).toHaveBeenCalledWith('creator-1');
    expect(onWishlist).toHaveBeenCalledWith('plan-1', false);
    expect(mockPush).not.toHaveBeenCalled();
    act(() => { outer(candidate).props.onPress(); });
    expect(mockPush).toHaveBeenCalledWith('/plan/plan-1');
  });

  it.each([5, 7])('keeps a joined plan with %s attendees free of admission prompts and opens its details', member_count => {
    const card = mount({ appearance, isMember: true, plan: { ...plan, member_count, allow_duplicate: true } });
    const text = renderedText(card.root).join(' ');
    expect(text).toContain('Going ✓');
    expect(outer(card).props.accessibilityLabel).toBe(`${plan.title} plan, going`);
    expect(text).not.toMatch(/Let's Go|Waitlist|Post your own|spots left|\d left/);
    const button = card.root.findAll(node => node.props.accessibilityLabel === 'Going, view plan' && typeof node.props.onPress === 'function')[0];
    act(() => button.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/plan/plan-1');
  });

  it('updates a mounted card after joining or leaving without retaining the previous participation state', () => {
    const card = mount({ appearance });
    expect(renderedText(card.root)).toContain("Let's Go →");
    act(() => card.update(<PlanCard plan={plan} appearance={appearance} isMember />));
    expect(renderedText(card.root)).toContain('Going ✓');
    act(() => card.update(<PlanCard plan={plan} appearance={appearance} isMember={false} />));
    expect(renderedText(card.root)).not.toContain('Going ✓');
    expect(renderedText(card.root)).toContain("Let's Go →");
  });

  it.each([
    [{member_count:7},false,false,'Waitlist →'],
    [{member_count:7},true,false,'Going ✓'],
    [{},true,true,'Ended'],
  ])('retains member/full/past distinctions %#', (changes,isMember,isPast,expected) => {
    const card=mount({appearance,plan:{...plan,...changes},isMember,isPast});
    const candidate=mount({appearance,plan:{...plan,...changes},isMember,isPast,layout:'title-first'});
    expect(renderedText(card.root)).toContain(expected);
    expect(renderedText(candidate.root)).toContain(expected);
  });
});

jest.mock('lucide-react-native', () => {
  const { Text: MockText } = require('react-native');
  return { Users: () => <MockText>users</MockText> };
});

jest.mock('../../../lib/haptics', () => ({
  hapticLight: jest.fn(),
  hapticMedium: jest.fn(),
  hapticSelection: jest.fn(),
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const plan = {
  id: 'plan-1',
  title: 'Love island reunion watch party',
  host_message: 'Would love to meet up with fellow islander watchers.',
  start_time: '2040-08-31T19:00:00-07:00',
  location_text: 'Happy Rabbit Bar and Lounge',
  category: 'Other',
  max_invites: 6,
  member_count: 2,
  creator: {
    id: 'creator-1',
    first_name_display: 'Anna',
    profile_photo_url: null,
  },
};

function renderedText(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children).flat(Infinity).filter(value=>typeof value==='string');
}

describe('PlanCard layout experiment', () => {
  it('uses the approved title-first layout by default and retains creator identity', () => {
    let card: ReturnType<typeof create>;
    act(() => {
      card = create(<PlanCard plan={plan} />);
    });

    const text = renderedText(card!.root);
    expect(text).toContain('Anna');
    expect(text.indexOf(plan.title)).toBeLessThan(text.indexOf('Anna'));
    act(() => card!.unmount());
  });

  it('leads with the activity and hides the creator name only in activity-first mode', () => {
    let card: ReturnType<typeof create>;
    act(() => {
      card = create(<PlanCard plan={plan} layout="activity-first" onCreatorPress={jest.fn()} />);
    });

    const text = renderedText(card!.root);
    expect(text).toContain('Love island reunion watch party');
    expect(text).not.toContain('Anna');
    expect(card!.root.findByProps({ accessibilityLabel: 'Open creator profile' })).toBeTruthy();
    expect(card!.root.findByProps({ accessibilityLabel: '2 going' })).toBeTruthy();
  });
});


describe('eligible feed source through toPlanCardPlan into the actual card', () => {
  const mounted: ReturnType<typeof create>[] = [];
  const source = (changes: Partial<Plan> = {}): Plan => ({
    ...plan, image_url: null, location_lat: null, location_lng: null,
    neighborhood: null, distance_km: null, slug: null, gender_rule: null,
    min_invites: 3, status: 'forming', is_featured: false, featured_type: null,
    cluster_root_id: null, allow_duplicate: false, ...changes,
  });
  const mountMapped = (row: Plan, props: Partial<React.ComponentProps<typeof PlanCard>> = {}) => {
    let card!: ReturnType<typeof create>;
    const mapped = toPlanCardPlan(row);
    act(() => { card = create(<PlanCard plan={mapped} appearance={{ fonts: AfterglowFonts }} {...props} />); });
    mounted.push(card);
    return { card, mapped, text: renderedText(card.root) };
  };
  afterEach(() => { act(() => mounted.splice(0).forEach(card => card.unmount())); jest.clearAllMocks(); });

  it('shows the existing public Circle provenance and configured cap while preserving the individual creator and plan destination', () => {
    const row = source({ circle_id: 'circle-1', circle_visibility: 'open', stranger_cap: 4, circle_size: 9, circle_in_count: 2 });
    const onCreatorPress = jest.fn();
    const { card, mapped, text } = mountMapped(row, { onCreatorPress });
    expect(mapped).toMatchObject({ circle_id: 'circle-1', circle_visibility: 'open', stranger_cap: 4, circle_size: 9, circle_in_count: 2 });
    expect(text).toEqual(expect.arrayContaining(['Friends group', 'A plan with an existing group of friends.', 'Check availability', 'View plan →', 'Anna']));
    expect(text.join(' ')).not.toContain('4 spots left');
    const creator = card.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Open Anna profile')!;
    act(() => creator.props.onPress({ stopPropagation: jest.fn() }));
    expect(onCreatorPress).toHaveBeenCalledWith('creator-1');
    const outer = card.root.findAllByType(TouchableOpacity).find(node => node.props.onLongPress)!;
    act(() => outer.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/plan/plan-1');
  });

  it.each([6, 7])('preserves a supplied outsider cap of %s and a real zero Circle attendance count', cap => {
    const { mapped, text } = mountMapped(source({ circle_id: 'circle-1', circle_visibility: 'open', stranger_cap: cap, circle_size: 9, circle_in_count: 0 }));
    expect(mapped.stranger_cap).toBe(cap);
    expect(mapped.circle_in_count).toBe(0);
    expect(text).toEqual(expect.arrayContaining(['Friends group', 'Check availability', 'View plan →']));
  });

  it('preserves circle-only exactly instead of giving a private source row public badges', () => {
    const { mapped, text } = mountMapped(source({ circle_id: 'circle-1', circle_visibility: 'circle_only', stranger_cap: null, circle_size: 9, circle_in_count: 2 }));
    expect(mapped.circle_visibility).toBe('circle_only');
    expect(mapped.stranger_cap).toBeNull();
    expect(text).toEqual(expect.arrayContaining(['Circle only', 'Circle members only', 'View plan →']));
    expect(text).not.toContain('Made from a circle');
    expect(text).not.toContain('open to the feed');
    expect(text.join(' ')).not.toMatch(/others welcome|of 9 in/);
  });

  it.each([null, undefined])('does not infer public or private visibility or zero capacity from an unknown value (%s)', visibility => {
    const { mapped, text } = mountMapped(source({ circle_id: 'circle-1', circle_visibility: visibility, stranger_cap: null, circle_size: null, circle_in_count: null }));
    expect(mapped.circle_visibility).toBe(visibility);
    expect(mapped.circle_size).toBeNull();
    expect(mapped.circle_in_count).toBeNull();
    expect(text).not.toContain('Made from a circle');
    expect(text).not.toContain('private to circle');
    expect(text).not.toContain('open to the feed');
    expect(text.join(' ')).not.toMatch(/others welcome|0 of 0 in/);
  });

  it.each([
    { count: 12, max: 6, spots: 2, footer: '2 spots open', action: "Let's Go →" },
    { count: 3, max: 15, spots: 0, footer: 'No open spots', action: 'View plan →' },
    { count: 12, max: 6, spots: 1, footer: '1 spot open', action: "Let's Go →" },
    ...[null, undefined, -1, 5, 1.5].map(spots => ({ count: 12, max: 6, spots, footer: 'Check availability', action: 'View plan →' })),
  ])('uses outsider availability independently of total attendance: %j', ({ count, max, spots, footer, action }) => {
    const { mapped, text, card } = mountMapped(source({ circle_id: 'circle-1', circle_visibility: 'open', stranger_cap: 4,
      spots_remaining: spots, member_count: count, max_invites: max, allow_duplicate: true }));
    expect(mapped.spots_remaining).toBe(spots);
    expect(text).toEqual(expect.arrayContaining([footer, action, 'Friends group']));
    expect(text.join(' ')).not.toMatch(/Waitlist|Post your own|Full/);
    const button = card.root.findAllByType(TouchableOpacity).find(node => renderedText(node).includes(action))!;
    act(() => button.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/plan/plan-1');
  });

  it('shows joined Circle participation instead of remaining public places', () => {
    const { text } = mountMapped(source({ circle_id: 'circle-1', circle_visibility: 'open', stranger_cap: 6, spots_remaining: 6 }), { isMember: true });
    expect(text).toEqual(expect.arrayContaining(['Going ✓', ' going']));
  });

  it('does not offer public places for private Circles or missing provenance', () => {
    for (const metadata of [
      { circle_id: 'circle-1', circle_visibility: 'circle_only' as const },
      { circle_id: undefined, circle_metadata_known: false },
      { circle_id: ' ', circle_metadata_known: false, circle_visibility: 'open' as const },
    ]) {
      const { text } = mountMapped(source({ ...metadata, stranger_cap: 7, spots_remaining: 7, member_count: 20, max_invites: 6, allow_duplicate: true }));
      expect(text).toContain('View plan →');
      expect(text.join(' ')).not.toMatch(/7 spots open|Waitlist|Post your own|Full|Friends group/);
    }
  });

  it('retains ordinary full/member actions without adding any Circle identity', () => {
    const normal = source({ member_count: 7 });
    const { mapped, text } = mountMapped(normal);
    expect(mapped.circle_id).toBeUndefined();
    expect(text).toContain('Waitlist →');
    expect(text).not.toContain('Made from a circle');
    expect(text).not.toContain('private to circle');
    const member = mountMapped(normal, { isMember: true });
    expect(member.text).toContain('Going ✓');
    expect(member.text).not.toContain('Waitlist →');
    expect(member.mapped.creator).toMatchObject({ id: 'creator-1', first_name_display: 'Anna', profile_photo_url: null });
  });
});

describe('card lifecycle follows real timestamps and terminal status', () => {
  let tree: ReturnType<typeof create>;
  const now = Date.parse('2030-09-14T20:00:00Z');
  const mount = (changes: any = {}, props: any = {}) => {
    jest.setSystemTime(now);
    act(() => { tree = create(<PlanCard plan={{ ...plan, start_time: new Date(now - 3600000).toISOString(), ...changes }} appearance={{ fonts: AfterglowFonts }} {...props} />); });
    return () => renderedText(tree.root);
  };
  afterEach(() => { if (tree) act(() => tree.unmount()); });
  it.each([
    [{ status: 'cancelled', start_time: '2040-01-01T00:00:00Z' }, 'Cancelled'],
    [{ status: 'completed', start_time: '2040-01-01T00:00:00Z' }, 'Completed'],
    [{ start_time: '2030-09-14T17:00:00Z' }, 'Ended'],
    [{ end_time: '2030-09-14T19:59:59Z' }, 'Ended'],
  ])('replaces all join/urgency signals for a closed plan %p', (changes, label) => {
    const text = mount({ ...changes, max_invites: 6, member_count: 7, allow_duplicate: true });
    expect(text()).toEqual(expect.arrayContaining([label, 'View plan →']));
    expect(text().join(' ')).not.toMatch(/Let's Go|Waitlist|Post your own|spots left|happening now|Full/);
    const outer = tree.root.findAllByType(TouchableOpacity).find(node => node.props.onLongPress)!;
    expect(outer.props.accessibilityLabel).toContain(String(label).toLowerCase());
    expect(StyleSheet.flatten(outer.props.style).opacity).toBe(1);
    act(() => outer.props.onPress()); expect(mockPush).toHaveBeenCalledWith('/plan/plan-1');
  });
  it('suppresses Circle availability and scarcity after ending while retaining provenance', () => {
    const text = mount({ end_time: '2030-09-14T19:59:59Z', circle_id: 'circle', circle_visibility: 'open', stranger_cap: 7, spots_remaining: 2 });
    expect(text()).toEqual(expect.arrayContaining(['Friends group', 'Ended', 'View plan →']));
    expect(text().join(' ')).not.toMatch(/spots open|Check availability|Let's Go/);
  });
  it('respects a long explicit duration and changes at the precise cutoff without a parent render', () => {
    const text = mount({ start_time: '2030-09-14T12:00:00Z', end_time: new Date(now + 1000).toISOString() });
    expect(text()).toContain('happening now');
    act(() => jest.advanceTimersByTime(1000));
    expect(text()).toEqual(expect.arrayContaining(['Ended', 'View plan →']));
    expect(text()).not.toContain('happening now');
  });
  it('changes when a plan starts, then uses the three-hour fallback end', () => {
    const text = mount({ start_time: new Date(now + 1000).toISOString() });
    expect(text()).not.toContain('happening now');
    act(() => jest.advanceTimersByTime(1000)); expect(text()).toContain('happening now');
    act(() => jest.advanceTimersByTime(3 * 3600000)); expect(text()).toContain('Ended');
  });
  it('preserves lifecycle values through the shared card mapper', () => {
    const mapped = toPlanCardPlan({ ...plan, status: 'cancelled', end_time: '2030-09-14T19:00:00Z' } as Plan);
    expect(mapped).toMatchObject({ status: 'cancelled', end_time: '2030-09-14T19:00:00Z' });
  });
});
