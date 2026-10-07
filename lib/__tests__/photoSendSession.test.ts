import { PhotoSendSession } from '../photoSendSession';

describe('photo retry identity', () => {
  it('reuses one message id and uploaded URL for the same selected photo', () => {
    let sequence = 0;
    const session = new PhotoSendSession(() => `photo-${++sequence}`);
    expect(session.idFor('file://first.jpg')).toBe('photo-1');
    session.rememberUploadedUrl('file://first.jpg', 'https://example.test/first.jpg');
    expect(session.idFor('file://first.jpg')).toBe('photo-1');
    expect(session.uploadedUrl('file://first.jpg')).toBe('https://example.test/first.jpg');
    expect(session.idFor('file://second.jpg')).toBe('photo-2');
  });

  it('starts a fresh identity when the preview session is cancelled or complete', () => {
    let sequence = 0;
    const session = new PhotoSendSession(() => `photo-${++sequence}`);
    session.idFor('file://same.jpg');
    session.rememberUploadedUrl('file://same.jpg', 'https://example.test/old.jpg');
    session.clear();
    expect(session.uploadedUrl('file://same.jpg')).toBeUndefined();
    expect(session.idFor('file://same.jpg')).toBe('photo-2');
  });
});

it('keeps a dispatched photo caption immutable until the session ends', () => {
  const session = new PhotoSendSession(() => 'identity');
  expect(session.hasCaption('a')).toBe(false);
  expect(session.captionFor('a', 'First')).toBe('First');
  expect(session.captionFor('a', 'Changed')).toBe('First');
  expect(session.captionFor('b', '')).toBe('');
  expect(session.hasCaption('b')).toBe(true);
  session.clear(); expect(session.hasCaption('a')).toBe(false);
  expect(session.captionFor('a', 'New selection')).toBe('New selection');
});
