import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { PlanCard } from '../PlanCard';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text: MockText } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <MockText>{name}</MockText> };
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
  start_time: '2026-08-31T19:00:00-07:00',
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
  return root.findAllByType(Text).map((node) => node.props.children).flat(Infinity).filter(Boolean);
}

describe('PlanCard layout experiment', () => {
  it('keeps the established creator-first layout by default', () => {
    let card: ReturnType<typeof create>;
    act(() => {
      card = create(<PlanCard plan={plan} />);
    });

    expect(renderedText(card!.root)).toContain('Anna');
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
