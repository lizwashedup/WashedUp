import { PhotoBatchFailure, sendPhotoBatch } from '../chatPhotoBatch';

describe('photo batch retry', () => {
  it('retries only unsent photos and does not repeat the first caption', async () => {
    const sent: string[] = [];
    let rejectSecond = true;
    const upload = async (asset: string) => asset;
    const send = async (caption: string, url: string) => {
      if (url === 'second' && rejectSecond) return false;
      sent.push(`${caption}|${url}`);
      return true;
    };

    await expect(sendPhotoBatch(['first', 'second', 'third'], upload, send, 'Meet here', false))
      .rejects.toMatchObject({ sentCount: 1, sendRejected: true });
    expect(sent).toEqual(['Meet here|first']);

    rejectSecond = false;
    await sendPhotoBatch(['second', 'third'], upload, send, 'Meet here', true);
    expect(sent).toEqual(['Meet here|first', '|second', '|third']);
  });

  it('retains the whole batch when the first upload fails', async () => {
    await expect(sendPhotoBatch(['first'], async () => { throw new Error('offline'); }, async () => true, 'Hello', false))
      .rejects.toEqual(new PhotoBatchFailure(0, false));
  });
});
