/**
 * Yours page — react-query key factory.
 *
 * Inbox/badge state reuses INBOX_COUNT_KEY from constants/QueryKeys.ts
 * (people requests surface there as action items).
 */
export const yoursKeys = {
  all: ['yours'] as const,
  grid: (userId: string) => ['yours', 'grid', userId] as const,
  backlog: (userId: string) => ['yours', 'backlog', userId] as const,
  search: (userId: string, q: string) =>
    ['yours', 'search', userId, q] as const,
  requests: (userId: string) => ['yours', 'requests', userId] as const,
  profileCard: (userId: string, targetId: string) =>
    ['yours', 'profile-card', userId, targetId] as const,
};
