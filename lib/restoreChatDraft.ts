/** Keep a failed send without overwriting anything typed while it was pending. */
export function restoreChatDraft(failedText: string, currentText: string): string {
  return currentText ? `${failedText}\n${currentText}` : failedText;
}
