import { communityMessagePreview, encodeCommunityLocation, parseCommunityLocation } from '../communityLocationMessage';

it('round-trips a location and keeps its chat preview readable', () => {
  const body = encodeCommunityLocation({ latitude: 34.009, longitude: -118.497, address: 'Santa Monica Pier' });
  expect(parseCommunityLocation(body)).toEqual({ latitude: 34.009, longitude: -118.497, address: 'Santa Monica Pier' });
  expect(communityMessagePreview(body)).toBe('Shared a location');
});

it('leaves ordinary text alone and rejects invalid coordinates', () => {
  expect(parseCommunityLocation('meet here')).toBeNull();
  expect(communityMessagePreview('meet here')).toBe('meet here');
  expect(() => encodeCommunityLocation({ latitude: 140, longitude: 1, address: 'Nope' })).toThrow();
});
