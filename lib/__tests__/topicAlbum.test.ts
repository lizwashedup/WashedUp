const mockFrom = jest.fn();
const mockCreateSignedUrl = jest.fn();
const mockStorageFrom = jest.fn(() => ({ createSignedUrl: mockCreateSignedUrl }));
const mockRpc = jest.fn();
jest.mock('../supabase', () => ({
  supabase: { from: mockFrom, storage: { from: mockStorageFrom }, rpc: mockRpc },
}));

const { getTopicAlbum, softDeleteTopicAlbumUpload } = require('../topicAlbum');

function albumChain(result: { data: unknown; error: unknown }) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue(result) };
}

function uploadsChain(result: { data: unknown; error: unknown }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(result),
  };
}

function profilesChain(data: unknown) {
  return { select: jest.fn().mockReturnThis(), in: jest.fn().mockResolvedValue({ data }) };
}

beforeEach(() => {
  mockFrom.mockReset();
  mockCreateSignedUrl.mockReset();
  mockStorageFrom.mockClear();
  mockRpc.mockReset();
  mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/ok' } });
});

describe('getTopicAlbum', () => {
  it('reports unavailable when the migration has not applied yet (missing relation)', async () => {
    mockFrom.mockReturnValueOnce(albumChain({ data: null, error: { code: '42P01' } }));

    const result = await getTopicAlbum('topic-1');

    expect(result).toEqual({ available: false, uploads: [] });
  });

  it('recognizes every documented missing-schema error code', async () => {
    for (const code of ['42P01', 'PGRST205', '42883', 'PGRST202']) {
      mockFrom.mockReturnValueOnce(albumChain({ data: null, error: { code } }));
      // eslint-disable-next-line no-await-in-loop
      expect(await getTopicAlbum('topic-1')).toEqual({ available: false, uploads: [] });
    }
  });

  it('treats a non-schema album read error as available-but-empty, not a throw', async () => {
    mockFrom.mockReturnValueOnce(albumChain({ data: null, error: { code: 'PGRST301' } }));
    await expect(getTopicAlbum('topic-1')).resolves.toEqual({ available: true, uploads: [] });
  });

  it('returns an honest empty album when no one has uploaded yet', async () => {
    mockFrom.mockReturnValueOnce(albumChain({ data: null, error: null }));
    await expect(getTopicAlbum('topic-1')).resolves.toEqual({ available: true, uploads: [] });
  });

  it('returns empty when the uploads read itself errors', async () => {
    mockFrom
      .mockReturnValueOnce(albumChain({ data: { id: 'album-1' }, error: null }))
      .mockReturnValueOnce(uploadsChain({ data: null, error: new Error('boom') }));
    await expect(getTopicAlbum('topic-1')).resolves.toEqual({ available: true, uploads: [] });
  });

  it('resolves uploader names and signed URLs, deduping profile lookups', async () => {
    mockFrom
      .mockReturnValueOnce(albumChain({ data: { id: 'album-1' }, error: null }))
      .mockReturnValueOnce(
        uploadsChain({
          data: [
            { id: 'up-1', user_id: 'user-1', media_url: 'topic-1/user-1/up-1/original.jpg', display_url: null, content_type: 'photo', created_at: '2026-08-19T00:00:00.000Z' },
            { id: 'up-2', user_id: 'user-1', media_url: 'topic-1/user-1/up-2/original.mp4', display_url: null, content_type: 'video', created_at: '2026-08-19T00:05:00.000Z' },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(profilesChain([{ id: 'user-1', first_name_display: 'Ada' }]));

    const result = await getTopicAlbum('topic-1');

    expect(result.available).toBe(true);
    expect(result.uploads).toHaveLength(2);
    expect(result.uploads[0]).toMatchObject({ id: 'up-1', uploaderName: 'Ada', contentType: 'photo' });
    expect(result.uploads[0].signedThumbUrl).toBe('https://signed.example/ok');
    // video content never requests a thumb transform, only the display URL
    expect(result.uploads[1]).toMatchObject({ id: 'up-2', contentType: 'video', signedThumbUrl: null });
    // one profile lookup for both uploads, since both are the same uploader
    expect(mockFrom).toHaveBeenCalledTimes(3);
  });

  it('keeps the tile when signing its URL fails, instead of dropping the whole album', async () => {
    mockCreateSignedUrl.mockRejectedValue(new Error('storage down'));
    mockFrom
      .mockReturnValueOnce(albumChain({ data: { id: 'album-1' }, error: null }))
      .mockReturnValueOnce(
        uploadsChain({
          data: [{ id: 'up-1', user_id: 'user-1', media_url: 'p.jpg', display_url: null, content_type: 'photo', created_at: 'now' }],
          error: null,
        }),
      )
      .mockReturnValueOnce(profilesChain([]));

    const result = await getTopicAlbum('topic-1');

    expect(result.uploads).toEqual([expect.objectContaining({ id: 'up-1', signedDisplayUrl: null, signedThumbUrl: null, uploaderName: null })]);
  });
});

describe('softDeleteTopicAlbumUpload', () => {
  it('calls the soft-delete RPC with the upload id', async () => {
    mockRpc.mockResolvedValue({ error: null });
    await softDeleteTopicAlbumUpload('up-1');
    expect(mockRpc).toHaveBeenCalledWith('soft_delete_topic_album_upload', { p_upload_id: 'up-1' });
  });

  it('throws when the RPC errors', async () => {
    mockRpc.mockResolvedValue({ error: new Error('nope') });
    await expect(softDeleteTopicAlbumUpload('up-1')).rejects.toThrow('nope');
  });
});
