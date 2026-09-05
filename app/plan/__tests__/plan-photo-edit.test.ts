import { resolveManagePlanImageUrl } from '../plan-photo-edit';

describe('resolveManagePlanImageUrl', () => {
  it('passes through an existing uploaded https photo unchanged', () => {
    expect(resolveManagePlanImageUrl('https://storage.example.com/event-images/abc.jpg')).toBe(
      'https://storage.example.com/event-images/abc.jpg',
    );
  });

  it('passes through an http photo unchanged', () => {
    expect(resolveManagePlanImageUrl('http://storage.example.com/event-images/abc.jpg')).toBe(
      'http://storage.example.com/event-images/abc.jpg',
    );
  });

  it('clears the photo when null (creator removed it)', () => {
    expect(resolveManagePlanImageUrl(null)).toBeNull();
  });

  it('clears the photo for an empty string', () => {
    expect(resolveManagePlanImageUrl('')).toBeNull();
  });

  it('never persists a local file:// URI (upload still in flight or failed)', () => {
    expect(resolveManagePlanImageUrl('file:///var/mobile/tmp/ImagePicker/abc.jpg')).toBeNull();
  });
});
