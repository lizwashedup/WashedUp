export class PhotoBatchFailure extends Error {
  constructor(public readonly sentCount: number, public readonly sendRejected: boolean) {
    super('Photo batch stopped before every photo was sent');
  }
}

/** Stop at the first failure so a retry contains only unsent assets. */
export async function sendPhotoBatch<T>(
  assets: T[],
  upload: (asset: T, index: number) => Promise<string>,
  send: (caption: string, url: string, asset: T, index: number) => Promise<boolean>,
  caption: string,
  captionAlreadySent: boolean,
): Promise<number> {
  let sentCount = 0;
  try {
    for (const [index, asset] of assets.entries()) {
      const url = await upload(asset, index);
      const sent = await send(index === 0 && !captionAlreadySent ? caption.trim() : '', url, asset, index);
      if (!sent) throw new PhotoBatchFailure(sentCount, true);
      sentCount += 1;
    }
    return sentCount;
  } catch (error) {
    if (error instanceof PhotoBatchFailure) throw error;
    throw new PhotoBatchFailure(sentCount, false);
  }
}
