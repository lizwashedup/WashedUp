/** Both transports require visible text, even for title-only inbox notices. */
export function pushNotificationText(notice: { title: string | null; body: string | null }) {
  const title = notice.title?.trim() ? notice.title : 'WashedUp';
  const body = notice.body?.trim() ? notice.body
    : notice.title?.trim() ? notice.title : 'Open WashedUp to see your update.';
  return { title, body };
}
