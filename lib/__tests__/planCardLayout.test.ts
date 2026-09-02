import {
  getActivityFirstCompanionPhotos,
  MAX_ACTIVITY_FIRST_COMPANIONS,
} from '../planCardLayout';

describe('activity-first plan-card avatar stack', () => {
  it('stays empty when only the creator is going', () => {
    expect(getActivityFirstCompanionPhotos(undefined, 1, 'creator.jpg')).toEqual([]);
  });

  it('caps the quiet companion stack and removes creator and duplicate photos', () => {
    expect(
      getActivityFirstCompanionPhotos(
        [
          { profile_photo_url: 'creator.jpg' },
          { profile_photo_url: 'friend-a.jpg' },
          { profile_photo_url: 'friend-a.jpg' },
          { profile_photo_url: 'friend-b.jpg' },
          { profile_photo_url: 'friend-c.jpg' },
        ],
        6,
        'creator.jpg',
      ),
    ).toEqual(['friend-a.jpg', 'friend-b.jpg']);
    expect(MAX_ACTIVITY_FIRST_COMPANIONS).toBe(2);
  });

  it('uses neutral slots when count exists but photos were not fetched', () => {
    expect(getActivityFirstCompanionPhotos(undefined, 3, null)).toEqual([null, null]);
  });
});
