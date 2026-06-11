/**
 * Yours page — react-query key factory.
 *
 * Inbox/badge state reuses INBOX_COUNT_KEY from constants/QueryKeys.ts
 * (people requests surface there as action items).
 */
export const yoursKeys = {
  grid: (userId: string) => ['yours', 'grid', userId] as const,
  backlog: (userId: string) => ['yours', 'backlog', userId] as const,
  handleLookup: (userId: string, q: string) =>
    ['yours', 'handle-lookup', userId, q] as const,
  requests: (userId: string) => ['yours', 'requests', userId] as const,
  profileCard: (userId: string, targetId: string) =>
    ['yours', 'profile-card', userId, targetId] as const,
  inviteSignals: (userId: string) => ['yours', 'invite-signals', userId] as const,
};
