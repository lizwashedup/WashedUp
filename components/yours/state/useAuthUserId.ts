import { useObservedUser } from '../../../hooks/useObservedUser';

/** Read-only current identity for the remaining legacy organization screen. */
export function useAuthUserId() {
  const identity = useObservedUser({ allowSignedOut: true });
  return {
    data: identity.isLoading || identity.error ? null : identity.viewerId ?? null,
    epoch: identity.epoch,
    isLoading: identity.isLoading,
    error: identity.error,
    refetch: identity.retry,
  };
}
