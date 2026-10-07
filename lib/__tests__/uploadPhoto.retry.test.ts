import { StorageApiError } from '@supabase/storage-js';
import { uploadBase64ToStorage } from '../uploadPhoto';
const mockUpload = jest.fn(), mockUrl = jest.fn();
jest.mock('../supabase', () => ({supabase:{storage:{from:()=>({upload:mockUpload,getPublicUrl:mockUrl})}}}));
jest.mock('expo-file-system/legacy', () => ({}));
beforeEach(() => {
  jest.clearAllMocks(); mockUpload.mockReset(); mockUrl.mockReturnValue({data:{publicUrl:'https://example.invalid/owned.jpg'}});
});
it.each([
  new StorageApiError('The resource already exists',400,'409'),
  new StorageApiError('The resource already exists',409,'ResourceAlreadyExists'),
  new StorageApiError('Asset Already Exists',400,'400'),
])('recovers an explicitly owned retry with SDK duplicate response %p', async error => {
  mockUpload.mockResolvedValue({error});
  await expect(uploadBase64ToStorage('chat-images','person/unique.jpg','AA==',{existingIsSuccess:true})).resolves.toContain('owned.jpg');
  expect(mockUpload.mock.calls[0][2].upsert).toBe(false);
});
it.each([
  new StorageApiError('new row violates row-level security policy',400,'403'),
  new StorageApiError('Conflict',409,'409'),
  new StorageApiError('network error',500,'500'),
])('retains a real failure for an owned retry %p', async error => {
  mockUpload.mockResolvedValue({error});
  await expect(uploadBase64ToStorage('chat-images','person/unique.jpg','AA==',{existingIsSuccess:true})).rejects.toBe(error);
  expect(mockUrl).not.toHaveBeenCalled();
});
it('does not treat an existing photo as success without an explicitly owned retry', async () => {
  const error = new StorageApiError('The resource already exists',400,'409');mockUpload.mockResolvedValue({error});
  await expect(uploadBase64ToStorage('chat-images','person/unique.jpg','AA==')).rejects.toBe(error);
  expect(mockUrl).not.toHaveBeenCalled();
});
