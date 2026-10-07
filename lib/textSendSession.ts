/** Reuse the insert UUID only while retrying an unchanged, unconfirmed text. */
export class TextSendSession {
  private pending: { id: string; text: string; replyToId: string | null } | null = null;

  constructor(private readonly makeId: () => string) {}

  idFor(text: string, replyToId: string | null): string {
    if (this.pending?.text === text && this.pending.replyToId === replyToId) return this.pending.id;
    const id = this.makeId();
    this.pending = { id, text, replyToId };
    return id;
  }

  clear(): void { this.pending = null; }
}
