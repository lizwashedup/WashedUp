/** Identity and successful upload URLs for one photo-preview session. */
export class PhotoSendSession {
  private readonly ids = new Map<string, string>();
  private readonly urls = new Map<string, string>();
  private readonly captions = new Map<string, string>();

  constructor(private readonly makeId: () => string) {}

  idFor(uri: string): string {
    let id = this.ids.get(uri);
    if (!id) {
      id = this.makeId();
      this.ids.set(uri, id);
    }
    return id;
  }

  uploadedUrl(uri: string): string | undefined { return this.urls.get(uri); }
  rememberUploadedUrl(uri: string, url: string): void { this.urls.set(uri, url); }
  /** Once dispatched, an uncertain message must retry its original content. */
  captionFor(uri: string, proposed: string): string {
    if (!this.captions.has(uri)) this.captions.set(uri, proposed);
    return this.captions.get(uri)!;
  }
  hasCaption(uri: string): boolean { return this.captions.has(uri); }
  clear(): void { this.ids.clear(); this.urls.clear(); this.captions.clear(); }
}
