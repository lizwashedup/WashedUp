import { boundPhotoOffset, fitChatPhoto } from '../chatPhotoLayout';

it.each([
  [{ width: 1200, height: 1600 }, { width: 240, height: 320 }],
  [{ width: 4000, height: 1000 }, { width: 240, height: 60 }],
  [{ width: 100, height: 10000 }, { width: 3.2, height: 320 }],
  [null, { width: 240, height: 180 }],
  [{ width: NaN, height: 0 }, { width: 240, height: 180 }],
])('preserves full photo aspect ratio for %j', (size, expected) => {
  expect(fitChatPhoto(size, { width: 240, height: 320 })).toEqual(expected);
});

it('keeps the enlarged photo over the viewport and prevents dragging a letterboxed axis', () => {
  expect(boundPhotoOffset(300, 375, 375, 2)).toBe(187.5);
  expect(boundPhotoOffset(-300, 375, 375, 2)).toBe(-187.5);
  expect(boundPhotoOffset(100, 200, 600, 2)).toBe(0);
  expect(boundPhotoOffset(-100, 375, 375, 1)).toBe(0);
});
