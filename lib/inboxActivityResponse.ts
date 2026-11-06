// Plural selects (including empty joins) have an array representation. A
// missing response cannot establish an empty conversation or a zero badge.
export function checkInboxActivityResponses(results: ReadonlyArray<{ error: unknown; data: unknown }>) {
  for (const result of results) {
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new Error('Conversation activity was not returned.');
  }
}

export function checkLatestMessageParents(data: unknown) {
  if (!Array.isArray(data) || data.some(row => !row || !Array.isArray(row.latest_message))) {
    throw new Error('The latest conversation activity was not returned.');
  }
}
