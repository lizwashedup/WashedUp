import * as React from 'react';
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

it('renders a communities nav button in the header, reachable even with zero communities', () => {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery />);
  });

  const button = tree!.root.findByProps({ accessibilityLabel: 'Browse communities' });
  expect(button).toBeTruthy();
});

it('navigates to /communities when the header button is pressed', () => {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<SceneDiscovery />);
  });

  const button = tree!.root.findByProps({ accessibilityLabel: 'Browse communities' });
  act(() => {
    button.props.onPress();
  });

  expect(mockPush).toHaveBeenCalledWith('/communities');
});
