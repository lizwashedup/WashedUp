import * as React from 'react';
import { Text } from 'react-native';
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

it('renders both destination tabs, Events selected by default', () => {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery />);
  });

  const eventsTab = tree!.root.findByProps({ accessibilityLabel: 'events' });
  const communitiesTab = tree!.root.findByProps({ accessibilityLabel: 'communities' });
  expect(eventsTab).toBeTruthy();
  expect(communitiesTab).toBeTruthy();
  expect(eventsTab.props.accessibilityState).toEqual({ selected: true });
  expect(communitiesTab.props.accessibilityState).toEqual({ selected: false });
});

it('switches to the Communities destination on tap, retaining the shared shell', () => {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery />);
  });

  const communitiesTab = tree!.root.findByProps({ accessibilityLabel: 'communities' });
  act(() => {
    communitiesTab.props.onPress();
  });

  const eventsTabAfter = tree!.root.findByProps({ accessibilityLabel: 'events' });
  const communitiesTabAfter = tree!.root.findByProps({ accessibilityLabel: 'communities' });
  expect(communitiesTabAfter.props.accessibilityState).toEqual({ selected: true });
  expect(eventsTabAfter.props.accessibilityState).toEqual({ selected: false });
});

it('switching destination never navigates away — Scene stays one shared screen', () => {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery />);
  });

  const communitiesTab = tree!.root.findByProps({ accessibilityLabel: 'communities' });
  act(() => {
    communitiesTab.props.onPress();
  });

  expect(mockPush).not.toHaveBeenCalled();
});

it('the creator recruiting card is always reachable on the Communities destination, even with zero communities', () => {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery />);
  });

  act(() => {
    tree!.root.findByProps({ accessibilityLabel: 'communities' }).props.onPress();
  });

  const hasRecruitCopy = tree!.root
    .findAllByType(Text)
    .some((n) => n.props.children === 'tell us about it');
  expect(hasRecruitCopy).toBe(true);
});
