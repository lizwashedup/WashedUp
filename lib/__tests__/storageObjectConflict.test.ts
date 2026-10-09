import { StorageApiError } from '@supabase/storage-js';
import { isStorageObjectConflict } from '../storageObjectConflict';

it.each([
  new StorageApiError('The resource already exists', 400, '409'),
  new StorageApiError('The resource already exists', 409, 'ResourceAlreadyExists'),
  new StorageApiError('Asset Already Exists', 400, '400'),
  { code: 'KeyAlreadyExists', status: 409 },
  { code: 'already_exists', status: 409 },
])('recognizes an explicit duplicate-object response %p', error => {
  expect(isStorageObjectConflict(error)).toBe(true);
});
it.each([
  new StorageApiError('new row violates row-level security policy', 400, '403'),
  new StorageApiError('upload failed', 500, '500'),
  new StorageApiError('The resource already exists', 403, '403'),
  { status: 409, code: 'BucketAlreadyExists', message: 'Bucket exists' },
  { status: 409, code: 'BucketAlreadyExists', message: 'The resource already exists' },
  { status: 409, message: 'Conflict' },
  { status: 400, message: 'Invalid MIME type' },
  { status: 429, code: 'ResourceAlreadyExists' },
  { status: 401, message: 'Asset Already Exists' },
  Error('The resource already exists'), null, undefined,
])('never turns an unrelated refusal into an upload receipt %p', error => {
  expect(isStorageObjectConflict(error)).toBe(false);
});
