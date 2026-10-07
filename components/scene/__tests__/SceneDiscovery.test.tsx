jest.mock('@react-navigation/native',()=>({useIsFocused:()=>true}));
jest.mock('../../../hooks/usePublicPageScope', () => ({ usePublicPageScope: () => ({ scope: null, account: {} }) }));
import * as React from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { SceneDiscovery } from '../SceneDiscovery';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('../../ProfileButton', () => () => null);

const mockPush = jest.fn();

beforeEach(() => {
  mockPush.mockClear();
  (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
  (useQuery as jest.Mock).mockReturnValue({ data: [], refetch: jest.fn(), isRefetching: false });
});

// SC-01: Scene is a shared shell with two destination states (Events,
// Communities), not a combined feed. These tests replace the old
// header-icon-navigates-to-/communities coverage now that Communities is a
// destination inside Scene itself, not a screen you navigate away to.

it('renders Communities before Events and selects Communities on ordinary entry', () => {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery communitiesEnabled />);
  });

  const eventsTab = tree!.root.findByProps({ accessibilityLabel: 'events' });
  const communitiesTab = tree!.root.findByProps({ accessibilityLabel: 'communities' });
  expect(eventsTab).toBeTruthy();
  expect(communitiesTab).toBeTruthy();
  expect(eventsTab.props.accessibilityState).toEqual({ selected: false });
  expect(communitiesTab.props.accessibilityState).toEqual({ selected: true });
  expect(tree!.root.findAll((node) => node.type === require('react-native').TouchableOpacity && node.props.accessibilityRole === 'tab').map(node => node.props.accessibilityLabel)).toEqual(['communities', 'events']);
});

it('ships event discovery without exposing Communities before its release gate opens', () => {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery communitiesEnabled={false} />);
  });

  expect(tree!.root.findByProps({ accessibilityLabel: 'events' })).toBeTruthy();
  expect(tree!.root.findAllByProps({ accessibilityLabel: 'communities' })).toHaveLength(0);
  expect(tree!.root.findAllByType(Text).some((node) => node.props.children === 'tell us about it')).toBe(false);
});

it('switches to Events on tap, retaining the shared shell', () => {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery communitiesEnabled />);
  });

  const eventsTab = tree!.root.findByProps({ accessibilityLabel: 'events' });
  act(() => {
    eventsTab.props.onPress();
  });

  const eventsTabAfter = tree!.root.findByProps({ accessibilityLabel: 'events' });
  const communitiesTabAfter = tree!.root.findByProps({ accessibilityLabel: 'communities' });
  expect(communitiesTabAfter.props.accessibilityState).toEqual({ selected: false });
  expect(eventsTabAfter.props.accessibilityState).toEqual({ selected: true });
});

it('switching destination never navigates away — Scene stays one shared screen', () => {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery communitiesEnabled />);
  });

  const communitiesTab = tree!.root.findByProps({ accessibilityLabel: 'communities' });
  act(() => {
    communitiesTab.props.onPress();
  });

  expect(mockPush).not.toHaveBeenCalled();
});

it('the application invitation stays reachable on Communities after a confirmed empty result', () => {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery communitiesEnabled />);
  });

  act(() => {
    tree!.root.findByProps({ accessibilityLabel: 'communities' }).props.onPress();
  });

  const hasRecruitCopy = tree!.root
    .findAllByType(Text)
    .some((n) => n.props.children === 'Start a community or organization');
  expect(hasRecruitCopy).toBe(true);
});

// TODAY item G (8/27 call guide): Scene briefly flashed the recruit-card
// invitation / "calendar is filling up" empty-state copy before the real
// query result was in, because both destinations treated useQuery's default
// `data: []` the same as a real zero-result answer. These two tests fail
// against the pre-fix code (isPending unread, both messages render
// immediately) and pass now that both destinations gate on isPending first.
it('shows a loading indicator, not the empty-state copy or the recruit card, while the events query is pending', () => {
  (useQuery as jest.Mock).mockReturnValue({
    data: [],
    refetch: jest.fn(),
    isRefetching: false,
    isPending: true,
  });

  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery communitiesEnabled />);
  });
  act(() => tree!.root.findByProps({ accessibilityLabel: 'events' }).props.onPress());

  const textChildren = tree!.root.findAllByType(Text).map((n) => n.props.children);
  expect(textChildren).not.toContain('No upcoming events yet.');
  expect(textChildren).not.toContain('Start a community or organization');
  expect(tree!.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
});

it('shows a loading indicator, not the recruit card, while the communities query is pending', () => {
  (useQuery as jest.Mock).mockReturnValue({
    data: [],
    refetch: jest.fn(),
    isRefetching: false,
    isPending: true,
  });

  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery communitiesEnabled />);
  });
  act(() => {
    tree!.root.findByProps({ accessibilityLabel: 'communities' }).props.onPress();
  });

  const hasRecruitCopy = tree!.root
    .findAllByType(Text)
    .some((n) => n.props.children === 'Start a community or organization');
  expect(hasRecruitCopy).toBe(false);
  expect(tree!.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
});

it('retains an explicit Events tab selection when the shared shell re-renders', () => {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<SceneDiscovery communitiesEnabled />); });
  act(() => tree.root.findByProps({ accessibilityLabel: 'events' }).props.onPress());
  act(() => tree.update(<SceneDiscovery communitiesEnabled />));
  expect(tree.root.findByProps({ accessibilityLabel: 'events' }).props.accessibilityState.selected).toBe(true);
  expect(tree.root.findByProps({ accessibilityLabel: 'communities' }).props.accessibilityState.selected).toBe(false);
  act(() => tree.unmount());
});

it('uses the exact application invitation wording and retains the same selector route', () => {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<SceneDiscovery communitiesEnabled />); });
  const text = tree.root.findAllByType(Text).map(node => node.props.children);
  expect(text).toContain('Start a community or organization');
  expect(text).toContain('Have a community or club, or put on events? Apply to manage your community or post events through your organization.');
  expect(text.join(' ')).not.toMatch(/refreshed Scene|next Scene|tell us about it|Get started/);
  expect(text).not.toContain('Be part of the next Scene.');
  act(() => tree.root.findByProps({ accessibilityLabel: 'Apply to be part of Scene' }).props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/creator/apply');
  act(() => tree.unmount());
});

it('states a confirmed empty event list factually and does not confuse a failed read with empty', () => {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<SceneDiscovery communitiesEnabled />); });
  act(() => tree.root.findByProps({ accessibilityLabel: 'events' }).props.onPress());
  expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain('No upcoming events yet.');
  (useQuery as jest.Mock).mockImplementation(({ queryKey }) => ({
    data: [], refetch: jest.fn(), isRefetching: false, isPending: false,
    isError: queryKey[0] === 'scene-events',
    error: queryKey[0] === 'scene-events' ? Error('Offline') : null,
  }));
  act(() => tree.update(<SceneDiscovery communitiesEnabled />));
  expect(tree.root.findAllByType(Text).map(node => node.props.children)).not.toContain('No upcoming events yet.');
  expect(tree.root.findByProps({ accessibilityLabel: 'try again' })).toBeTruthy();
  act(() => tree.unmount());
});
